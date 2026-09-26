# Fork add-ons and upstream merges

This fork keeps its installable web app and background alerts as add-ons: new files that plug
into the journal through Next.js conventions, so merging new commits from the upstream project
touches as little as possible.

## Where the add-ons touch upstream files

| File                         | Change                                                                                                           | If a merge conflicts                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `apps/web/src/middleware.ts` | One import and one line: `if (isPublicAppAsset(pathname)) return NextResponse.next();` after the `/login` check. | Keep upstream's version and add the line back after its public-path checks. |
| `CHANGELOG.md`               | Entries under `[Unreleased]`.                                                                                    | Keep both.                                                                  |

Nothing else upstream owns is changed: no database schema, bootstrap or upgrade edits (the
add-on creates its own tables), no dependencies (`package.json` and the lockfile are untouched;
push uses Node's crypto), no `next.config.ts` or `layout.tsx` edits.

## Files the add-ons own

- Installable app: `app/manifest.ts`, `app/icons/[name]/route.tsx`, `app/apple-icon.tsx`,
  `components/app-icon.tsx`, `lib/pwa.ts`, `instrumentation-client.ts`, `public/sw.js`.
- Background alerts: `server/background-alerts/*`, `instrumentation.ts`,
  `instrumentation-node.ts`, `app/api/alerts/**`, `components/background-alerts.tsx`,
  `lib/alert-messages.ts`, tests `background-alerts.test.ts` and `web-push.test.ts`.
- Fork code they plug into (the chart section, not upstream): one `<BackgroundAlerts>` element in
  `app/charts/page.tsx`, and the process-wide feed map in `server/market-data/live.ts`.

## If upstream adds the same Next.js convention files

Next.js allows one `instrumentation.ts`, one `instrumentation-client.ts` and one
`app/manifest.ts`. If upstream adds its own, merge by calling both: keep upstream's `register()`
body and add `await import("./instrumentation-node")` for the Node runtime; append the service
worker registration to upstream's client file; and prefer upstream's manifest, keeping the
`/icons/*` entries if it has none.
