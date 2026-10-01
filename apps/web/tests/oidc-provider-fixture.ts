import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, SignJWT, type JWK, type JWTPayload } from "jose";

/**
 * A small OpenID Connect provider for tests, shaped like Authentik: per-application issuer
 * `…/application/o/<slug>/` with a trailing slash, discovery, JWKS, token, userinfo and
 * end-session endpoints. The token endpoint really checks client authentication, the
 * single-use code, the redirect URI and the PKCE verifier, so `openid-client` runs its real
 * protocol code against it. Tests steer what it signs through `next`.
 */

export interface TokenOverrides {
  /** Claims merged into (or, with `undefined`, removed from) the ID token. */
  claims?: Record<string, unknown>;
  /** How the ID token is signed. */
  sign?: "rs256" | "hs256" | "other-key" | "none";
  /** Userinfo claims; default: the ID token's. */
  userinfo?: Record<string, unknown>;
  /** Leave the ID token out of the token response. */
  noIdToken?: boolean;
}

interface Grant {
  clientId: string;
  redirectUri: string;
  nonce: string;
  challenge: string;
  overrides: TokenOverrides;
  used: boolean;
}

export interface ProviderOptions {
  clientId: string;
  /** Null for a public client (no client authentication, PKCE only). */
  clientSecret: string | null;
  /** What discovery advertises for ID token signing. */
  algs?: string[];
  /** Serve a different `issuer` in discovery than where it is served (a mix-up). */
  advertisedIssuer?: string;
}

export async function startProvider(options: ProviderOptions) {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const other = await generateKeyPair("RS256", { extractable: true });
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: "key-1", alg: "RS256", use: "sig" };
  const grants = new Map<string, Grant>();
  const tokens = new Map<string, Record<string, unknown>>();
  const requests: { path: string; headers: IncomingMessage["headers"]; body: string }[] = [];

  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", origin);
      requests.push({ path: url.pathname, headers: req.headers, body });
      const json = (status: number, value: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify(value));
      };
      if (url.pathname === `${path}.well-known/openid-configuration`) return json(200, metadata());
      if (url.pathname === `${path}jwks/`) return json(200, { keys: [jwk] });
      if (url.pathname === "/application/o/token/" && req.method === "POST")
        return void token(req, body).then(([status, value]) => json(status, value));
      if (url.pathname === "/application/o/userinfo/") {
        const bearer = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
        const claims = tokens.get(bearer);
        return claims ? json(200, claims) : json(401, { error: "invalid_token" });
      }
      json(404, { error: "not_found" });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const path = "/application/o/journal/";
  const issuer = `${origin}${path}`;

  const metadata = () => ({
    issuer: options.advertisedIssuer ?? issuer,
    authorization_endpoint: `${origin}/application/o/authorize/`,
    token_endpoint: `${origin}/application/o/token/`,
    userinfo_endpoint: `${origin}/application/o/userinfo/`,
    end_session_endpoint: `${issuer}end-session/`,
    jwks_uri: `${issuer}jwks/`,
    response_types_supported: ["code", "id_token", "id_token token", "code token"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: options.algs ?? ["RS256"],
    scopes_supported: ["openid", "email", "profile"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
    code_challenge_methods_supported: ["plain", "S256"],
    claims_supported: ["sub", "iss", "aud", "exp", "iat", "email", "email_verified", "name"],
  });

  const clientAuthenticated = (req: IncomingMessage, form: URLSearchParams) => {
    if (options.clientSecret === null) return form.get("client_id") === options.clientId;
    const basic = req.headers.authorization?.match(/^Basic (.+)$/)?.[1];
    if (basic) {
      const [id, secret] = Buffer.from(basic, "base64")
        .toString("utf8")
        .split(":")
        .map((part) => decodeURIComponent(part));
      return id === options.clientId && secret === options.clientSecret;
    }
    return (
      form.get("client_id") === options.clientId &&
      form.get("client_secret") === options.clientSecret
    );
  };

  async function token(req: IncomingMessage, body: string): Promise<[number, unknown]> {
    const form = new URLSearchParams(body);
    if (!clientAuthenticated(req, form)) return [401, { error: "invalid_client" }];
    const grant = grants.get(form.get("code") ?? "");
    if (!grant || grant.used) return [400, { error: "invalid_grant" }];
    grant.used = true;
    if (form.get("redirect_uri") !== grant.redirectUri) return [400, { error: "invalid_grant" }];
    const verifier = form.get("code_verifier") ?? "";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    if (challenge !== grant.challenge) return [400, { error: "invalid_grant" }];
    const now = Math.floor(Date.now() / 1000);
    const claims: Record<string, unknown> = {
      iss: issuer,
      sub: "user-hash-1",
      aud: grant.clientId,
      exp: now + 300,
      iat: now,
      auth_time: now,
      nonce: grant.nonce,
      sid: "provider-session-1",
      email: "trader@example.com",
      email_verified: true,
      name: "Test Trader",
      preferred_username: "trader",
      groups: ["traders"],
    };
    for (const [key, value] of Object.entries(grant.overrides.claims ?? {}))
      if (value === undefined) delete claims[key];
      else claims[key] = value;
    const accessToken = randomBytes(16).toString("hex");
    tokens.set(accessToken, grant.overrides.userinfo ?? claims);
    const response: Record<string, unknown> = {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 300,
      scope: "openid profile email",
    };
    if (!grant.overrides.noIdToken)
      response.id_token = await signToken(claims as JWTPayload, grant.overrides.sign ?? "rs256");
    return [200, response];
  }

  async function signToken(claims: JWTPayload, how: NonNullable<TokenOverrides["sign"]>) {
    if (how === "none") {
      const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
      return `${part({ alg: "none", typ: "JWT" })}.${part(claims)}.`;
    }
    if (how === "hs256")
      return new SignJWT(claims)
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .sign(new TextEncoder().encode(options.clientSecret ?? "not-the-secret"));
    return new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "key-1", typ: "JWT" })
      .sign(how === "other-key" ? other.privateKey : privateKey);
  }

  return {
    issuer,
    origin,
    requests,
    /**
     * The user signs in at the provider: from the authorization URL the journal sent,
     * return the parameters of the redirect back (code, state, iss).
     */
    authorize(authorizationUrl: string, overrides: TokenOverrides = {}) {
      const url = new URL(authorizationUrl);
      const p = url.searchParams;
      if (p.get("code_challenge_method") !== "S256") throw new Error("expected PKCE S256");
      const code = randomBytes(16).toString("hex");
      grants.set(code, {
        clientId: p.get("client_id") ?? "",
        redirectUri: p.get("redirect_uri") ?? "",
        nonce: p.get("nonce") ?? "",
        challenge: p.get("code_challenge") ?? "",
        overrides,
        used: false,
      });
      return new URLSearchParams({ code, state: p.get("state") ?? "", iss: issuer });
    },
    /** A back-channel logout token, as the provider would post it. */
    async logoutToken(claims: Record<string, unknown> = {}, how: "rs256" | "hs256" = "rs256") {
      const now = Math.floor(Date.now() / 1000);
      const payload: Record<string, unknown> = {
        iss: issuer,
        aud: options.clientId,
        iat: now,
        jti: randomBytes(8).toString("hex"),
        sid: "provider-session-1",
        sub: "user-hash-1",
        events: { "http://schemas.openid.net/event/backchannel-logout": {} },
      };
      for (const [key, value] of Object.entries(claims))
        if (value === undefined) delete payload[key];
        else payload[key] = value;
      if (how === "hs256")
        return new SignJWT(payload as JWTPayload)
          .setProtectedHeader({ alg: "HS256", typ: "logout+jwt" })
          .sign(new TextEncoder().encode(options.clientSecret ?? ""));
      return new SignJWT(payload as JWTPayload)
        .setProtectedHeader({ alg: "RS256", kid: "key-1", typ: "logout+jwt" })
        .sign(privateKey);
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export type TestProvider = Awaited<ReturnType<typeof startProvider>>;
