# Project review and performance

Reviewed September 2, 2026. The review covered the app routes and shared components, journal storage, calculation and import packages, dependency lockfile, and build/release configuration. Product changes are listed in [Changes from the original](fork-changes.md).

## Measurements

These are local production-build measurements on the same machine and disposable data. Each API result is the median of six sequential warm requests after one warm-up; it includes the full HTTP response read. The fixture contains 10,000 synthetic stored trades and roughly 25,700 rule assessments, with a separate six-trade account for testing account selection. These numbers are not field Core Web Vitals or guarantees for other hardware.

| Check                                                     | Before this performance review |   After |
| --------------------------------------------------------- | -----------------------------: | ------: |
| Dashboard API, 10,000 trades                              |                       259.7 ms | 82.5 ms |
| Cross-analysis, symbol × weekday                          |                        63.2 ms | 51.9 ms |
| Strategy-adherence report                                 |                     5,361.9 ms | 61.1 ms |
| Full trade API, 10,000 trades                             |                       100.7 ms | 71.8 ms |
| Trade-link lookup                                         |                        10.8 ms |  2.8 ms |
| Dashboard API, six-trade account within the large journal |                        48.2 ms |  1.9 ms |

The six compared JSON responses were identical before and after optimization. The trade-list view now requests a smaller projection: 5,219,503 bytes versus 10,486,175 bytes for the full 10,000-trade fixture. It renders 50 rows at a time while sorting and totals use the entire filtered result.

| Initial JavaScript, gzip |        Before |         After |
| ------------------------ | ------------: | ------------: |
| Dashboard                | 730,667 bytes | 368,481 bytes |
| Reports                  | 559,406 bytes | 210,761 bytes |
| Notebook                 | 245,696 bytes | 255,990 bytes |
| Trades                   | 198,983 bytes | 219,667 bytes |

JavaScript totals sum the initial script files referenced by each page's production HTML, compressed separately with gzip. Deferred chart/export modules are excluded from initial totals. The dashboard is approximately 50% smaller and Reports 62% smaller. The restored shared account selector and paging add a modest amount to Notebook and Trades.

The chart improvement comes from importing only ECharts components actually used and loading the chart when its panel approaches the viewport. Analytical improvements remove repeated full-metric computations inside every breakdown, reuse daily/equity results, narrow account queries before decoding and replace nested adherence searches with maps.

Use `python3 scripts/benchmark-journal.py --base-url http://127.0.0.1:3002 --account ACCOUNT_ID` to repeat read-only API measurements on a local production build. Keep the data and hardware unchanged for comparisons. The measured baseline is the customized journal immediately before this review, not the upstream release.

## Reliability fixes

- Validate optional-password sessions in the API handler, including rejection of forged cookies and invalidation when the password changes.
- Deduplicate simultaneous reads and cancel requests after the final consumer leaves. Do not retain completed financial data in a shared client cache or display old-account responses under newly selected filters.
- Validate executions and account references before insertion. Commit fills and their calculated trades together, rolling back on failure. Avoid parameter-limit failures during rebuild cleanup.
- Retain folder definitions and calculation/display settings in JSON exports; exclude credentials.
- Include the PDF font and third-party license notices in Docker's production image. Align the documented app runtime with Node 22+, which its installed dependencies require.
- Exclude runtime databases, local backups and working outputs from production file tracing and Docker's build context. This also prevents large backups from delaying the packaging step.
- Upgrade Drizzle ORM and override vulnerable transitive PostCSS/esbuild versions. The reviewed lockfile audit reports zero advisories. Advisory references: [Drizzle](https://github.com/drizzle-team/drizzle-orm/security/advisories/GHSA-gpj5-g38j-94v9), [PostCSS](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp), [esbuild](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr). This audit result is not a claim that all dependencies are vulnerability-free.
- Preserve Pako's MIT and Zlib notices with a documented package-specific license exception for PDF compression. The overall license gate remains active.

## Verification

- 93 automated tests passed, covering original trade matching/imports plus filters, R calculations, defaults, privacy, notes, trade links, routine schedules, attachments, exports, dashboard state/motion, report equivalence, API read lifecycle, password sessions and transactional storage.
- TypeScript validation and the optimized web build passed.
- Both package builds, formatting checks and the dependency license gate passed.
- Ten disposable-data integration scenarios passed, including default fees/risk, reimport deduplication, annotation preservation, filter agreement, adherence, routines, notes, attachments, missed-trade isolation, currency identification and multiplier recalculation.
- HTTP checks rejected missing/forged sessions and unauthorized writes, accepted a valid login, and verified lightweight account choices, demo-account reuse and the expanded export fields.
- Browser checks verify the restored account/demo selector, account-scoped navigation, 16 dashboard cards, large-history paging, global sorting and selection, and responsive controls.
- The original comparison instance and user journal data stay separate from disposable test fixtures.
- The production preview serves the existing journal on port 3000. A read-only comparison verified that every user-data table retained its contents, and the generated build contains no journal database or encryption-secret file.

## Limits

Live broker sync, paid AI calls and real microphone transcription require external services or credentials and were not exercised. Docker image execution was not tested on this machine; the app and package builds were tested directly, and the Docker file-copy paths were reviewed. Automatic MAE/MFE and replay remain outside this implementation.

`pnpm dev` compiles routes on demand and is slower than a production build. Stop the development server before running `pnpm build` and then `pnpm start` in the same checkout when evaluating runtime speed.
