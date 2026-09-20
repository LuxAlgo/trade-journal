# AI account and filter scope

Ask your journal and daily recaps use the account selection and analysis filters shown on the page. The client sends the computed date range, rather than asking the server to reinterpret a relative range. The server validates that snapshot, then uses the same trade query and timezone as the journal before building any AI context.

- All accounts remains the default when no account filter is selected. An explicitly malformed or unknown account selection is rejected; it never falls back to all accounts.
- No matching trades produces a data-specific message without a provider call. A daily recap also requires closed trades on the requested local calendar day.
- Context includes the scope and per-account totals with account names and currencies. Mixed-currency sums are explicitly described as unconverted.
- Answers are labeled with their scope. Changing filters clears the answer and invalidates pending responses, including a switch away from and back to the same account. Leaving a page also invalidates pending responses.
- A daily note is still shared by date across accounts. Recaps for an account or other trade subset do not include that shared note in the provider context. An all-account, otherwise unfiltered day recap can still use the note. Date range filters alone do not narrow that day's trades further.
- A completed recap appends a labeled section to the latest draft, preserving edits made during generation. A response from an obsolete scope cannot append or save a recap.
- Single-trade critique continues to use the trade key and is unchanged.

## API contract

Both routes require a `filters` object using the journal's `AnalysisFilters` string fields; `{}` explicitly requests all trades. Ask also requires `question`, and recap requires a valid `date` in `YYYY-MM-DD` format. The UI sends `timeZone`; a mismatch with the server setting requires a page refresh. The routes reject unknown request fields, invalid filters, reversed ranges and missing account IDs.

Successful responses retain `answer` or `recap` and add `scope: { label, timeZone }`. The display label masks monetary filter amounts, consistent with private filter descriptions. The provider receives the actual numeric filters and matching aggregates.

## Verification without an AI connection

Run `pnpm test apps/web/tests/ai-scope.test.ts apps/web/tests/ai-ui.test.ts apps/web/tests/ai-feedback.test.ts`.

The route tests use an isolated SQLite database and replace only `runAi`, recording the exact context from the real handlers. The fixture has Account A at +10 and Account B at -50; A alone must contain no B trade data, while a combined selection reports -40 and the separate account totals. Tests cover each supported filter, invalid selections, empty results, local-midnight boundaries, overnight time windows, shared notes and single-trade critique.

The React DOM tests use controlled delayed responses to exercise the actual Ask component and daily journal page. They verify outgoing filter snapshots, scope labels, account/date/timezone changes, returning to an earlier scope, obsolete errors, duplicate clicks, retries, unmounting and edits made while a recap is pending.

These checks verify data selection and UI behavior, not provider connectivity or generated prose quality. The normal local app still requires a configured AI provider to generate real answers. No mock-provider mode is included in the application. Existing shared-note writes from separate browser tabs remain last-write-wins; this change protects edits made in the active editor during generation.
