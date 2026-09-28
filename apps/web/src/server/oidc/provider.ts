import * as client from "openid-client";
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from "jose";
import { oidcConfig, type OidcSettings } from "./config";
import {
  createSession,
  deleteSession,
  deleteSessionsFor,
  saveTransaction,
  takeTransaction,
} from "./store";

/**
 * The OpenID Connect relying party, on `openid-client` (protocol) and `jose` (signatures):
 * authorization code flow with PKCE (S256), `state` and `nonce`, issuer discovery, ID token
 * validation (signature, issuer, audience, expiry, nonce), optional userinfo for missing
 * claims, RP-initiated logout and back-channel logout. Errors carry a short code for the
 * login page; tokens, codes and secrets never reach logs or messages.
 */

export type OidcErrorCode =
  | "config" // sign-in is not configured correctly
  | "unavailable" // the provider could not be reached or answered badly
  | "denied" // the provider returned an error (the user cancelled, access denied)
  | "state" // unknown, expired or already-used login, or a response for another login
  | "token" // the ID token or token response failed validation
  | "forbidden"; // signed in, but not someone allowed into this journal

export class OidcError extends Error {
  constructor(
    readonly code: OidcErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Only the error's own message, never its `cause` (which can hold token responses). */
export function logOidcFailure(stage: string, error: unknown) {
  const code = error instanceof OidcError ? error.code : "unexpected";
  const message = error instanceof Error ? error.message.slice(0, 300) : "unknown error";
  const details =
    error instanceof client.AuthorizationResponseError
      ? ` (${error.error}${error.error_description ? `: ${error.error_description.slice(0, 200)}` : ""})`
      : "";
  console.warn(`[oidc] ${stage} failed [${code}]: ${message}${details}`);
}

export const settingsOrThrow = (): OidcSettings => {
  const result = oidcConfig();
  if (!result.enabled) throw new OidcError("config", "Single sign-on is not configured.");
  if (!result.ok) throw new OidcError("config", result.problem);
  return result.settings;
};

/**
 * What went wrong, in words: openid-client wraps protocol errors ("invalid response
 * encountered") around the specific check that failed. Only messages are read; the error
 * objects' other properties can hold token responses and are never logged.
 */
const reason = (error: unknown): string => {
  if (!(error instanceof Error)) return "validation failed";
  return error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message;
};

// ── Discovery ──

const DISCOVERY_TTL_MS = 24 * 3600_000;
const HTTP_TIMEOUT_SECONDS = 10;
let discovered: { key: string; at: number; config: Promise<client.Configuration> } | null = null;

const settingsKey = (s: OidcSettings) =>
  JSON.stringify([s.issuer.href, s.clientId, Boolean(s.clientSecret), s.allowHttp]);

/** Forget the discovered provider (tests, or a provider that changed its keys or endpoints). */
export function resetOidcDiscovery() {
  discovered = null;
  jwksByUrl.clear();
}

async function discover(settings: OidcSettings): Promise<client.Configuration> {
  const metadata: Partial<client.ClientMetadata> = {
    redirect_uris: [settings.redirectUri.href],
    response_types: ["code"],
  };
  const execute = settings.allowHttp ? [client.allowInsecureRequests] : [];
  const auth = settings.clientSecret
    ? client.ClientSecretBasic(settings.clientSecret)
    : client.None();
  let config: client.Configuration;
  try {
    // Discovery checks that the document's `issuer` is exactly this URL (OIDC Discovery 4.3).
    config = await client.discovery(settings.issuer, settings.clientId, metadata, auth, {
      execute,
      timeout: HTTP_TIMEOUT_SECONDS,
    });
  } catch (error) {
    throw new OidcError(
      "unavailable",
      `Could not read the provider's discovery document at ${settings.issuer.href}: ${reason(error)}`,
    );
  }
  const server = config.serverMetadata();
  if (!server.authorization_endpoint || !server.token_endpoint)
    throw new OidcError("unavailable", "The provider does not advertise the code flow endpoints.");
  if (
    server.code_challenge_methods_supported &&
    !server.code_challenge_methods_supported.includes("S256")
  )
    throw new OidcError("config", "The provider does not support PKCE with S256.");
  // Client secret basic is the default (RFC 6749); use post when that is all it takes.
  const methods = server.token_endpoint_auth_methods_supported;
  if (
    settings.clientSecret &&
    methods &&
    !methods.includes("client_secret_basic") &&
    methods.includes("client_secret_post")
  ) {
    config = new client.Configuration(
      server,
      settings.clientId,
      metadata,
      client.ClientSecretPost(settings.clientSecret),
    );
    if (settings.allowHttp) client.allowInsecureRequests(config);
  }
  config.timeout = HTTP_TIMEOUT_SECONDS;
  return config;
}

export async function providerConfig(settings: OidcSettings): Promise<client.Configuration> {
  const key = settingsKey(settings);
  if (!discovered || discovered.key !== key || Date.now() - discovered.at > DISCOVERY_TTL_MS) {
    const config = discover(settings);
    discovered = { key, at: Date.now(), config };
    // A failed discovery is retried on the next sign-in instead of being cached.
    config.catch(() => {
      if (discovered?.config === config) discovered = null;
    });
  }
  return discovered.config;
}

// ── Signatures ──

const ASYMMETRIC = [
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
  "ES256",
  "ES384",
  "ES512",
  "EdDSA",
  "Ed25519",
];
const SYMMETRIC = ["HS256", "HS384", "HS512"];
const CLOCK_TOLERANCE_SECONDS = 30;

const jwksByUrl = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const remoteKeys = (url: string) => {
  let set = jwksByUrl.get(url);
  if (!set) {
    set = createRemoteJWKSet(new URL(url), { timeoutDuration: HTTP_TIMEOUT_SECONDS * 1000 });
    jwksByUrl.set(url, set);
  }
  return set;
};

/**
 * Verify a JWT from the provider (an ID token or a logout token): its signature with the
 * provider's published keys, or with the client secret for HS256 (Authentik without a
 * signing key), then issuer, audience and time claims. `none` is never accepted.
 */
async function verifyProviderJwt(
  jwt: string,
  settings: OidcSettings,
  config: client.Configuration,
  advertised: string[] | undefined,
  options: { maxTokenAge?: string } = {},
): Promise<JWTPayload> {
  const server = config.serverMetadata();
  let alg: string | undefined;
  try {
    alg = decodeProtectedHeader(jwt).alg;
  } catch {
    throw new OidcError("token", "The token is not a signed JWT.");
  }
  const symmetric = alg !== undefined && SYMMETRIC.includes(alg);
  const allowed = (symmetric ? SYMMETRIC : ASYMMETRIC).filter(
    (candidate) => !advertised || advertised.includes(candidate),
  );
  if (!alg || !allowed.includes(alg))
    throw new OidcError(
      "token",
      `The token's signing algorithm ${alg ?? "(none)"} is not accepted.`,
    );
  if (symmetric && !settings.clientSecret)
    throw new OidcError(
      "token",
      "The provider signs with the client secret (HS256) but no JOURNAL_OIDC_CLIENT_SECRET is set.",
    );
  if (!symmetric && !server.jwks_uri)
    throw new OidcError("token", "The provider publishes no signing keys (jwks_uri).");
  try {
    const verifyOptions = {
      algorithms: allowed,
      issuer: server.issuer,
      audience: settings.clientId,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      maxTokenAge: options.maxTokenAge,
    };
    const { payload } = symmetric
      ? await jwtVerify(jwt, new TextEncoder().encode(settings.clientSecret!), verifyOptions)
      : await jwtVerify(jwt, remoteKeys(server.jwks_uri!), verifyOptions);
    // A token "issued" in the future is not one the provider issued now (clock tolerance aside).
    if (
      typeof payload.iat !== "number" ||
      payload.iat > Date.now() / 1000 + CLOCK_TOLERANCE_SECONDS
    )
      throw new Error('"iat" claim is missing or in the future');
    return payload;
  } catch (error) {
    throw new OidcError(
      "token",
      `The token failed verification: ${error instanceof Error ? error.message : "invalid"}`,
    );
  }
}

// ── Sign-in ──

export async function startLogin(returnTo: string): Promise<{ url: URL; transactionId: string }> {
  const settings = settingsOrThrow();
  const config = await providerConfig(settings);
  const state = client.randomState();
  const nonce = client.randomNonce();
  const codeVerifier = client.randomPKCECodeVerifier();
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: settings.redirectUri.href,
    scope: settings.scopes.join(" "),
    state,
    nonce,
    code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: "S256",
  });
  const transactionId = saveTransaction({ state, nonce, codeVerifier, returnTo });
  return { url, transactionId };
}

export interface OidcIdentity {
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string;
  groups: string[];
  sid: string | null;
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export function identityFrom(
  claims: Record<string, unknown>,
  settings: OidcSettings,
): OidcIdentity {
  const subject = text(claims.sub);
  if (!subject) throw new OidcError("token", "The ID token has no subject (sub).");
  const raw = claims[settings.groupsClaim];
  const groups = (Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [])
    .filter((group): group is string => typeof group === "string")
    .map((group) => group.trim())
    .filter(Boolean);
  const email = text(claims.email).toLowerCase();
  return {
    subject,
    email,
    emailVerified: claims.email_verified === true,
    name: text(claims.name) || text(claims.preferred_username) || email || subject,
    groups,
    sid: text(claims.sid) || null,
  };
}

/** Whether this identity may open the journal; any matching rule is enough. */
export function isAllowed(identity: OidcIdentity, settings: OidcSettings): boolean {
  const { allow } = settings;
  if (allow.any) return true;
  if (allow.subjects.includes(identity.subject)) return true;
  if (
    identity.email &&
    allow.emails.includes(identity.email) &&
    (identity.emailVerified || settings.trustUnverifiedEmail)
  )
    return true;
  return identity.groups.some((group) => allow.groups.includes(group));
}

export interface CompletedLogin {
  sessionCookie: string;
  maxAgeSeconds: number;
  returnTo: string;
  identity: OidcIdentity;
}

/**
 * Finish a sign-in from the provider's redirect: the transaction (single use, from this
 * browser's cookie) supplies the expected state, nonce and PKCE verifier; the code is
 * exchanged at the token endpoint and the ID token validated before a session exists.
 */
export async function finishLogin(
  callbackUrl: URL,
  transactionId: string | undefined,
): Promise<CompletedLogin> {
  const settings = settingsOrThrow();
  const transaction = takeTransaction(transactionId);
  if (!transaction)
    throw new OidcError(
      "state",
      "This sign-in expired or was already used, or started in another browser.",
    );
  const config = await providerConfig(settings);
  // The provider redirected to the registered URI; rebuild it so a proxy in front of the
  // journal cannot change the redirect_uri sent with the code.
  const current = new URL(settings.redirectUri.href);
  current.search = callbackUrl.search;

  let tokens: Awaited<ReturnType<typeof client.authorizationCodeGrant>>;
  try {
    tokens = await client.authorizationCodeGrant(config, current, {
      pkceCodeVerifier: transaction.codeVerifier,
      expectedState: transaction.state,
      expectedNonce: transaction.nonce,
      idTokenExpected: true,
    });
  } catch (error) {
    if (error instanceof client.AuthorizationResponseError)
      throw new OidcError(
        "denied",
        `The provider refused the sign-in: ${error.error}${error.error_description ? ` (${error.error_description})` : ""}`,
      );
    if (error instanceof client.ResponseBodyError)
      throw new OidcError("token", `The token endpoint refused the code: ${error.error}`);
    throw new OidcError(/"state"/.test(reason(error)) ? "state" : "token", reason(error));
  }

  const idToken = tokens.id_token;
  const validated = tokens.claims();
  if (!idToken || !validated) throw new OidcError("token", "The provider returned no ID token.");
  // openid-client checked iss, aud, azp, exp, iat and nonce; the signature is checked here.
  const signed = await verifyProviderJwt(
    idToken,
    settings,
    config,
    config.serverMetadata().id_token_signing_alg_values_supported,
  );
  if (signed.nonce !== transaction.nonce)
    throw new OidcError("token", "The ID token nonce differs.");

  let claims: Record<string, unknown> = { ...validated };
  const needsGroups =
    settings.allow.groups.length > 0 && claims[settings.groupsClaim] === undefined;
  const needsEmail = settings.allow.emails.length > 0 && claims.email === undefined;
  if ((needsGroups || needsEmail) && config.serverMetadata().userinfo_endpoint) {
    try {
      // The subject must match the ID token's (OIDC Core 5.3.2), which openid-client checks.
      const userinfo = await client.fetchUserInfo(config, tokens.access_token, validated.sub);
      claims = { ...userinfo, ...claims };
    } catch (error) {
      throw new OidcError(
        "unavailable",
        `Could not read the user's claims from the userinfo endpoint: ${reason(error)}`,
      );
    }
  }
  const identity = identityFrom(claims, settings);
  if (!isAllowed(identity, settings))
    throw new OidcError(
      "forbidden",
      `Signed in as ${identity.subject}, who is not allowed into this journal.`,
    );
  const sessionCookie = createSession({
    issuer: settings.issuer.href,
    subject: identity.subject,
    sid: identity.sid,
    name: identity.name,
    email: identity.email,
    idToken: settings.logout === "provider" ? idToken : null,
    maxAgeSeconds: settings.sessionMaxAgeSeconds,
  });
  return {
    sessionCookie,
    maxAgeSeconds: settings.sessionMaxAgeSeconds,
    returnTo: transaction.returnTo,
    identity,
  };
}

// ── Sign-out ──

/**
 * End the journal session behind `cookie`. With `JOURNAL_OIDC_LOGOUT=provider` (the
 * default) and a provider that has an end-session endpoint, also returns where to send the
 * browser so the provider ends its session (OIDC RP-Initiated Logout 1.0).
 */
export async function logout(cookie: string | undefined): Promise<URL | null> {
  const ended = deleteSession(cookie);
  const result = oidcConfig();
  if (!result.enabled || !result.ok || result.settings.logout !== "provider") return null;
  const settings = result.settings;
  let config: client.Configuration;
  try {
    config = await providerConfig(settings);
  } catch (error) {
    logOidcFailure("logout", error);
    return null;
  }
  if (!config.serverMetadata().end_session_endpoint) return null;
  const parameters: Record<string, string> = {
    post_logout_redirect_uri: new URL("/login", settings.redirectUri).href,
  };
  if (ended?.idToken) parameters.id_token_hint = ended.idToken;
  return client.buildEndSessionUrl(config, parameters);
}

const LOGOUT_EVENT = "http://schemas.openid.net/event/backchannel-logout";

/**
 * OIDC Back-Channel Logout 1.0: the provider tells the journal that a session ended.
 * Validates the logout token (signature, iss, aud, iat within five minutes, jti, the
 * back-channel event, sid or sub, no nonce) and ends the matching journal sessions.
 */
export async function backchannelLogout(logoutToken: string): Promise<number> {
  const settings = settingsOrThrow();
  const config = await providerConfig(settings);
  const payload = await verifyProviderJwt(
    logoutToken,
    settings,
    config,
    config.serverMetadata().id_token_signing_alg_values_supported,
    { maxTokenAge: "5m" },
  );
  const events = payload.events as Record<string, unknown> | undefined;
  if (!events || typeof events[LOGOUT_EVENT] !== "object" || events[LOGOUT_EVENT] === null)
    throw new OidcError("token", "The logout token has no back-channel logout event.");
  if (typeof payload.jti !== "string" || !payload.jti)
    throw new OidcError("token", "The logout token has no jti.");
  if (payload.nonce !== undefined)
    throw new OidcError("token", "A logout token must not carry a nonce.");
  const sid = typeof payload.sid === "string" && payload.sid ? payload.sid : undefined;
  const sub = typeof payload.sub === "string" && payload.sub ? payload.sub : undefined;
  if (!sid && !sub) throw new OidcError("token", "The logout token names no session or subject.");
  return deleteSessionsFor(settings.issuer.href, { sid, sub });
}
