import { createHash, randomBytes } from "node:crypto";
import { db } from "@/db";
import { decryptJson, encryptJson } from "../crypto";

/**
 * Sign-in state for OpenID Connect, in tables of its own (created on first use, like the
 * background alerts add-on) so the journal's schema and upgrades stay untouched.
 *
 * - A login transaction holds what the callback must check (state, nonce, PKCE verifier)
 *   and where to go afterwards. It is found by a random id kept in an HttpOnly cookie, so
 *   the callback only completes in the browser that started it, and it is deleted on first
 *   use, so an authorization response cannot be replayed.
 * - A session is a random id in the journal's session cookie. Only SHA-256 hashes of ids
 *   are stored, so the database alone never grants a session.
 */

const DDL = `
CREATE TABLE IF NOT EXISTS oidc_login_transactions (
 id_hash TEXT PRIMARY KEY, state TEXT NOT NULL, nonce TEXT NOT NULL, code_verifier TEXT NOT NULL,
 return_to TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_sessions (
 id_hash TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL, sid TEXT,
 name TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', id_token TEXT,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_sessions_subject ON auth_sessions(issuer, subject);
CREATE INDEX IF NOT EXISTS auth_sessions_sid ON auth_sessions(issuer, sid);
`;

const ready = new WeakSet<object>();
const client = () => {
  if (!ready.has(db)) {
    db.$client.exec(DDL);
    ready.add(db);
  }
  return db.$client;
};

/** Session cookies from this store carry this prefix; the password session never does. */
export const OIDC_SESSION_PREFIX = "o1.";

const newId = () => randomBytes(32).toString("base64url");
const hash = (id: string) => createHash("sha256").update(id, "utf8").digest("hex");
const now = () => Date.now();

// ── Login transactions ──

export interface LoginTransaction {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
}

export const TRANSACTION_TTL_MS = 10 * 60_000;

/** Store a transaction; returns the id for the browser's cookie. */
export function saveTransaction(transaction: LoginTransaction): string {
  const id = newId();
  const sql = client();
  sql.prepare("DELETE FROM oidc_login_transactions WHERE expires_at <= ?").run(now());
  sql
    .prepare(
      "INSERT INTO oidc_login_transactions (id_hash, state, nonce, code_verifier, return_to, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(
      hash(id),
      transaction.state,
      transaction.nonce,
      transaction.codeVerifier,
      transaction.returnTo,
      now() + TRANSACTION_TTL_MS,
    );
  return id;
}

/** Take a transaction out (single use); null when unknown or expired. */
export function takeTransaction(id: string | undefined): LoginTransaction | null {
  if (!id) return null;
  const row = client()
    .prepare(
      "DELETE FROM oidc_login_transactions WHERE id_hash = ? RETURNING state, nonce, code_verifier, return_to, expires_at",
    )
    .get(hash(id)) as
    | { state: string; nonce: string; code_verifier: string; return_to: string; expires_at: number }
    | undefined;
  if (!row || row.expires_at <= now()) return null;
  return {
    state: row.state,
    nonce: row.nonce,
    codeVerifier: row.code_verifier,
    returnTo: row.return_to,
  };
}

// ── Sessions ──

export interface NewSession {
  issuer: string;
  subject: string;
  sid: string | null;
  name: string;
  email: string;
  /** Kept (encrypted) only as the hint for provider logout. */
  idToken: string | null;
  maxAgeSeconds: number;
}

export interface SessionInfo {
  issuer: string;
  subject: string;
  sid: string | null;
  name: string;
  email: string;
  expiresAt: number;
}

/** Create a session; returns the cookie value. */
export function createSession(session: NewSession): string {
  const id = newId();
  const sql = client();
  sql.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").run(now());
  sql
    .prepare(
      "INSERT INTO auth_sessions (id_hash, issuer, subject, sid, name, email, id_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      hash(id),
      session.issuer,
      session.subject,
      session.sid,
      session.name,
      session.email,
      session.idToken ? encryptJson(session.idToken) : null,
      now(),
      now() + session.maxAgeSeconds * 1000,
    );
  return `${OIDC_SESSION_PREFIX}${id}`;
}

const idOf = (cookie: string | undefined) =>
  cookie?.startsWith(OIDC_SESSION_PREFIX) ? cookie.slice(OIDC_SESSION_PREFIX.length) : null;

/** The live session behind a cookie, for this issuer only. */
export function findSession(cookie: string | undefined, issuer: string): SessionInfo | null {
  const id = idOf(cookie);
  if (!id) return null;
  const row = client()
    .prepare(
      "SELECT issuer, subject, sid, name, email, expires_at FROM auth_sessions WHERE id_hash = ? AND issuer = ? AND expires_at > ?",
    )
    .get(hash(id), issuer, now()) as
    | {
        issuer: string;
        subject: string;
        sid: string | null;
        name: string;
        email: string;
        expires_at: number;
      }
    | undefined;
  return row ? { ...row, expiresAt: row.expires_at } : null;
}

/** End a session; returns its ID token (for the provider's logout hint), if it had one. */
export function deleteSession(cookie: string | undefined): { idToken: string | null } | null {
  const id = idOf(cookie);
  if (!id) return null;
  const row = client()
    .prepare("DELETE FROM auth_sessions WHERE id_hash = ? RETURNING id_token")
    .get(hash(id)) as { id_token: string | null } | undefined;
  if (!row) return null;
  let idToken: string | null = null;
  try {
    idToken = row.id_token ? decryptJson<string>(row.id_token) : null;
  } catch {
    idToken = null;
  }
  return { idToken };
}

/** Back-channel logout: end the sessions of a provider session (`sid`) or of a user (`sub`). */
export function deleteSessionsFor(issuer: string, match: { sid?: string; sub?: string }): number {
  const sql = client();
  if (match.sid)
    return sql
      .prepare(
        "DELETE FROM auth_sessions WHERE issuer = ? AND sid = ? AND (? IS NULL OR subject = ?)",
      )
      .run(issuer, match.sid, match.sub ?? null, match.sub ?? null).changes;
  if (match.sub)
    return sql
      .prepare("DELETE FROM auth_sessions WHERE issuer = ? AND subject = ?")
      .run(issuer, match.sub).changes;
  return 0;
}
