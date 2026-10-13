# Authentication

The journal is single-user and open by default: it is your data on your machine. Before you
make it reachable from a network, turn on at least one way of signing in:

- **Password**: set `JOURNAL_PASSWORD`. One shared password, sessions last 30 days, changing
  the password signs everyone out.
- **Single sign-on**: sign in through an OpenID Connect provider such as
  [Authentik](https://goauthentik.io), Keycloak, Zitadel, Authelia, Okta or Entra ID. Set
  `JOURNAL_OIDC_ISSUER` and the settings below.

Both can be on at once; the login page then offers both. Either way the API checks the
session on every request, and pages without a session redirect to `/login`.

## How single sign-on works

The journal is an OpenID Connect relying party using the **authorization code flow with
PKCE**, built on [`openid-client`](https://github.com/panva/openid-client) (protocol) and
[`jose`](https://github.com/panva/jose) (signatures):

1. **Sign in with …** on the login page goes to `/api/auth/oidc/login`. The journal reads the
   provider's discovery document (`<issuer>/.well-known/openid-configuration`), creates a
   random `state`, `nonce` and PKCE verifier (S256), stores them server-side for ten
   minutes, and puts a random login id in an HttpOnly cookie scoped to `/api/auth/oidc`.
   The browser goes to the provider's authorization endpoint.
2. You sign in at the provider, which redirects to `/api/auth/oidc/callback` with a code.
3. The callback takes the stored login out, once: a second use, another browser, a
   different `state` or a login older than ten minutes is refused. It exchanges the code at
   the token endpoint (with the client secret and the PKCE verifier) and validates the ID
   token.
4. When the identity is allowed, the journal creates a session and returns you to the page
   you asked for.

What is checked before a session exists:

| Check           | Detail                                                                                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Issuer          | The discovery document's `issuer` equals `JOURNAL_OIDC_ISSUER` exactly; the ID token's `iss` matches it; an `iss` on the redirect must match too (mix-up). |
| Audience        | `aud` contains the client ID; with several audiences, `azp` must be the client ID.                                                                         |
| Signature       | Against the provider's published keys (`jwks_uri`), or the client secret for HS256. `none` and unadvertised algorithms are refused.                        |
| Time            | `exp` in the future and `iat` not in the future, with 30 seconds of clock tolerance.                                                                       |
| Replay and CSRF | `state` from this browser's login; `nonce` in the ID token equal to the one sent; the PKCE verifier binds the code to the login that asked for it.         |
| Subject         | `sub` present; claims from the userinfo endpoint are only used when their `sub` matches.                                                                   |
| Who may sign in | At least one allow rule matches (see below).                                                                                                               |

Sessions are random ids in the `journal_session` cookie (HttpOnly, SameSite=Lax, Secure on
https). The database keeps only a SHA-256 hash of each id, bound to the issuer: changing
`JOURNAL_OIDC_ISSUER` ends existing sessions. **Sign out** (at the bottom of the sidebar)
deletes the session on the server, so a copied cookie stops working, then sends you to the
provider's end-session page (see `JOURNAL_OIDC_LOGOUT`). A provider that supports
**back-channel logout** can end journal sessions when your session there ends.

Nothing is logged that grants access: no codes, tokens, session ids or secrets. Sign-in
failures are logged as `[oidc] … failed [code]: reason`, and the login page shows a short
explanation.

## Settings

| Env var                               | Effect                                                                                                                                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JOURNAL_OIDC_ISSUER`                 | **Turns single sign-on on.** The provider's issuer URL, exactly as its discovery document states it (Authentik: `https://auth.example.com/application/o/<slug>/`, with the trailing slash). Must be https.                      |
| `JOURNAL_OIDC_CLIENT_ID`              | **Required.** The client ID from the provider.                                                                                                                                                                                  |
| `JOURNAL_OIDC_CLIENT_SECRET`          | The client secret (confidential client, recommended). Leave unset for a public client, which then relies on PKCE alone.                                                                                                         |
| `JOURNAL_PUBLIC_URL`                  | **Required** (or the next one). The address you open the journal at, such as `https://journal.example.com`. The redirect URI is `<JOURNAL_PUBLIC_URL>/api/auth/oidc/callback`.                                                  |
| `JOURNAL_OIDC_REDIRECT_URI`           | The full redirect URI, when it differs from the one above. Must end in `/api/auth/oidc/callback`.                                                                                                                               |
| `JOURNAL_OIDC_ALLOWED_GROUPS`         | Comma-separated group names; any one lets you in. Read from the `groups` claim (Authentik sends group names there with the `profile` scope).                                                                                    |
| `JOURNAL_OIDC_ALLOWED_EMAILS`         | Comma-separated email addresses (case-insensitive). Only matched when the provider says the email is verified (`email_verified: true`).                                                                                         |
| `JOURNAL_OIDC_ALLOWED_SUBJECTS`       | Comma-separated `sub` values (stable user ids at the provider). The log shows your `sub` when a sign-in is refused.                                                                                                             |
| `JOURNAL_OIDC_ALLOW_ALL_USERS`        | `true` to let in anyone the provider signs in. Only when the provider itself limits who can use this application (Authentik: a policy, group or user binding on the application).                                               |
| `JOURNAL_OIDC_TRUST_UNVERIFIED_EMAIL` | `true` to match `JOURNAL_OIDC_ALLOWED_EMAILS` even when `email_verified` is false. Avoid it when users can edit their own email at the provider (they can in Authentik by default).                                             |
| `JOURNAL_OIDC_GROUPS_CLAIM`           | The claim holding groups (default `groups`).                                                                                                                                                                                    |
| `JOURNAL_OIDC_SCOPES`                 | Space- or comma-separated scopes (default `openid profile email`; must include `openid`).                                                                                                                                       |
| `JOURNAL_OIDC_LABEL`                  | The provider's name on the login button (default `Single sign-on`).                                                                                                                                                             |
| `JOURNAL_OIDC_LOGOUT`                 | `provider` (default): **Sign out** also sends you to the provider's end-session endpoint, with your ID token as `id_token_hint` and `<public URL>/login` as `post_logout_redirect_uri`. `local`: only the journal session ends. |
| `JOURNAL_OIDC_SESSION_HOURS`          | How long a session lasts (default 168, a week). The provider is not asked again until it ends; sign out, or back-channel logout, ends it sooner.                                                                                |
| `JOURNAL_OIDC_ALLOW_HTTP`             | `true` allows a plain-HTTP issuer and redirect URI, for a provider running on your own machine. Never in production. (A journal on `http://localhost` needs no flag.)                                                           |

**Who may sign in is required.** Set at least one of the allow lists, or
`JOURNAL_OIDC_ALLOW_ALL_USERS=true`. Without one the journal stays locked: an issuer that is
set always requires a sign-in, even when the rest of the configuration is wrong. The login
page then says single sign-on is misconfigured and the server log names the setting.

URLs to register at the provider:

| URL                                                     | What it is                                     |
| ------------------------------------------------------- | ---------------------------------------------- |
| `<JOURNAL_PUBLIC_URL>/api/auth/oidc/callback`           | Redirect URI (required)                        |
| `<JOURNAL_PUBLIC_URL>/login`                            | Post-logout redirect URI (for provider logout) |
| `<JOURNAL_PUBLIC_URL>/api/auth/oidc/backchannel-logout` | Back-channel logout URI (optional)             |

## Authentik

Verified against Authentik 2026.8.3 with an RS256 signing key and with HS256 (no key):
sign-in, a user outside the allowed group, sign-out through the invalidation flow and back,
and back-channel logout when the Authentik session is deleted.

### In Authentik

1. **Applications → Applications → Create with provider.** Name it (for example
   `Trade Journal`); its slug (`trade-journal`) is part of the issuer URL.
2. Provider type **OAuth2/OpenID Provider**:
   - **Authorization flow**: `default-provider-authorization-implicit-consent` (or the
     explicit-consent flow to confirm each sign-in).
   - **Client type**: Confidential. Copy the **Client ID** and **Client Secret**.
   - **Redirect URIs**: add
     `https://journal.example.com/api/auth/oidc/callback` with matching mode **Strict** and
     type **Authorization**, and `https://journal.example.com/login`, Strict, type
     **Logout**. With the logout entry, Authentik sends you back to the journal after
     signing out; without it, it stays on its own "You've logged out" page.
   - **Signing Key**: `authentik Self-signed Certificate` (or your own). Recommended: the
     journal verifies RS256/ES256 signatures with the published keys. Without a signing
     key Authentik signs with HS256 and the client secret; the journal accepts that too
     when `JOURNAL_OIDC_CLIENT_SECRET` is set.
   - **Advanced protocol settings**: keep the scopes `openid`, `email` and `profile`
     (`profile` carries `groups`), **Subject mode** "Based on the User's hashed ID", and
     **Include claims in id_token** on (the journal falls back to the userinfo endpoint
     otherwise).
   - **Logout URI** `https://journal.example.com/api/auth/oidc/backchannel-logout` with
     **Logout Method** Back-channel (optional): when your Authentik session ends (you log
     out of Authentik, or an admin ends the session), your journal sessions end too.
     Authentik must be able to reach that URL.
3. Limit access: create a group (for example `traders`), add yourself, and either bind the
   group to the application (**Policy / Group / User Bindings**) or rely on the journal's
   allow list below. Both is best.
4. Authentik 2025.10 and later send `email_verified: false` unless you change the email
   scope mapping, so allow by group or subject rather than by email.

If you create the provider through Authentik's API instead of the admin interface, set its
`grant_types` to `["authorization_code"]`: a provider created by the API without it refuses
the code flow ("Invalid grant_type for provider").

### In the journal

```bash
JOURNAL_PUBLIC_URL=https://journal.example.com
JOURNAL_OIDC_ISSUER=https://auth.example.com/application/o/trade-journal/
JOURNAL_OIDC_CLIENT_ID=<client id>
JOURNAL_OIDC_CLIENT_SECRET=<client secret>
JOURNAL_OIDC_ALLOWED_GROUPS=traders
JOURNAL_OIDC_LABEL=Authentik
```

With Docker Compose, add them to the service's `environment` (see
[`docker-compose.yml`](../docker-compose.yml)). The journal container must reach the issuer
URL (discovery, keys, token endpoint), and for back-channel logout Authentik must reach the
journal.

## Other providers

Any provider with OpenID Connect discovery and the authorization code flow works:

- **Keycloak**: issuer `https://keycloak.example.com/realms/<realm>`; a confidential client
  with the redirect URI above; add a "Group Membership" mapper named `groups` (turn off
  "Full group path" to match plain names) for `JOURNAL_OIDC_ALLOWED_GROUPS`.
- **Zitadel, Authelia, Okta, Entra ID, Google**: use the issuer from their discovery
  document; groups may come in another claim (`JOURNAL_OIDC_GROUPS_CLAIM`) or not at all,
  in which case allow by subject or verified email.

## Local development

`JOURNAL_PUBLIC_URL=http://localhost:3000` is enough for the journal side. A provider on
your own machine over plain HTTP also needs `JOURNAL_OIDC_ALLOW_HTTP=true` (for example
Authentik at `http://localhost:9000/application/o/trade-journal/`). Register
`http://localhost:3000/api/auth/oidc/callback` as a redirect URI there.

Behind a reverse proxy, set `JOURNAL_PUBLIC_URL` to the external https address. The journal
uses it for the redirect URI and cookie security, never the Host header of the request.

## Troubleshooting

The login page shows what failed; the server log (`[oidc] … failed [code]`) has the reason.

| Login page says                                     | Usual cause                                                                                                                                                       |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Single sign-on is not configured correctly          | A missing or invalid setting; the log names it.                                                                                                                   |
| The sign-in provider could not be reached           | The issuer URL is wrong (`issuer does not match`: check the trailing slash), the provider is down, or the journal cannot reach it.                                |
| The sign-in provider did not sign you in            | You cancelled, or the provider refused the request (`invalid_request`: often the redirect URI is not registered, or the Authentik provider lacks the code grant). |
| That sign-in expired or was already used            | More than ten minutes at the provider, the back button after signing in, or a different browser. Start again.                                                     |
| The sign-in provider's answer could not be verified | Wrong client secret (`invalid_client`), clock skew over 30 seconds, or a signing setup the journal does not accept.                                               |
| Your account is not allowed into this journal       | No allow rule matched; the log shows the `sub` to add to `JOURNAL_OIDC_ALLOWED_SUBJECTS`, or add the user to an allowed group.                                    |

## Limits

- The journal has one set of data: everyone allowed in sees and edits the same journal.
- There are no refresh tokens and no API tokens: the journal only needs to know who you are
  when you sign in, and its own session lasts `JOURNAL_OIDC_SESSION_HOURS`. Disabling a
  user at the provider ends their journal session only through back-channel logout, sign
  out, or the session running out.
- Front-channel logout is not supported; use back-channel logout.
