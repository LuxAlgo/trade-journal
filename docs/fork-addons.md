# Fork add-ons and upstream merges

This fork keeps its installable web app and background alerts as add-ons: new files that plug
into the journal through Next.js conventions, so merging new commits from the upstream project
touches as little as possible.

## Where the add-ons touch upstream files

| File                                                              | Change                                                                                                                                                            | If a merge conflicts                                                        |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `apps/web/src/middleware.ts`                                      | One import and one line: `if (isPublicAppAsset(pathname)) return NextResponse.next();` after the `/login` check.                                                  | Keep upstream's version and add the line back after its public-path checks. |
| `CHANGELOG.md`                                                    | Entries under `[Unreleased]`.                                                                                                                                     | Keep both.                                                                  |
| `apps/web/src/middleware.ts` (single sign-on)                     | The gate also turns on for `JOURNAL_OIDC_ISSUER`, lets `/api/auth/*` through, and passes `?next=` to `/login`.                                                    | Keep upstream's version and re-add the three changes.                       |
| `apps/web/src/server/auth.ts`, `server/api.ts`                    | `authRequired()` (password or OIDC) replaces `passwordConfigured()` in the handler gate; `verifySession` also accepts `o1.` sessions from `server/oidc/store.ts`. | Keep upstream's password logic and re-add `authRequired`/`oidcSession`.     |
| `apps/web/src/app/api/auth/route.ts`, `app/login/page.tsx`        | A public `GET` describing the sign-in methods; the login page's SSO button, error codes and `next` return path.                                                   | Keep upstream's password flow and re-add the SSO parts.                     |
| `apps/web/src/components/shell.tsx`                               | `<SignOutButton />` under the privacy toggle (desktop sidebar and mobile drawer).                                                                                 | Re-add the import and the two elements.                                     |
| `apps/web/package.json`, `pnpm-lock.yaml`                         | `openid-client` and `jose` (MIT).                                                                                                                                 | Keep upstream's and re-add the two dependencies.                            |
| `apps/web/src/app/journal/page.tsx`                               | Two imports and two elements above the day list: `<WeeklyReview timeZone={timeZone} />` and `<DayTypeStats />`.                                                   | Keep upstream's page and add the two elements back above the day list.      |
| `apps/web/src/app/api/ai/recap/route.ts`, `.../critique/route.ts` | `await` before `linkedAnalyses(...)` (it fetches the day's price action).                                                                                         | Keep upstream's route and add the `await` back.                             |

Nothing else upstream owns is changed: no database schema, bootstrap or upgrade edits (the
add-ons create their own tables), no `next.config.ts` or `layout.tsx` edits. The only
dependencies added are single sign-on's (push uses Node's crypto).

## Files the add-ons own

- Installable app: `app/manifest.ts`, `app/icons/[name]/route.tsx`, `app/apple-icon.tsx`,
  `components/app-icon.tsx`, `lib/pwa.ts`, `instrumentation-client.ts`, `public/sw.js`.
- Background alerts: `server/background-alerts/*`, `instrumentation.ts`,
  `instrumentation-node.ts`, `app/api/alerts/**`, `components/background-alerts.tsx`,
  `lib/alert-messages.ts`, tests `background-alerts.test.ts` and `web-push.test.ts`.
- Single sign-on: `server/oidc/*` (configuration, provider client, sessions and login
  transactions in their own tables), `app/api/auth/oidc/**`, `app/api/auth/logout/route.ts`,
  `components/sign-out.tsx`, `lib/auth-redirect.ts`, `docs/authentication.md`, tests
  `oidc-auth.test.ts`, `oidc-config.test.ts` and `oidc-provider-fixture.ts`.
- Fork code they plug into (the chart section, not upstream): one `<BackgroundAlerts>` element in
  `app/charts/page.tsx`, and the process-wide feed map in `server/market-data/live.ts`.

## If upstream adds the same Next.js convention files

Next.js allows one `instrumentation.ts`, one `instrumentation-client.ts` and one
`app/manifest.ts`. If upstream adds its own, merge by calling both: keep upstream's `register()`
body and add `await import("./instrumentation-node")` for the Node runtime; append the service
worker registration to upstream's client file; and prefer upstream's manifest, keeping the
`/icons/*` entries if it has none.
