# Prop firm spend and payout tracker

The **Prop firms** sidebar page tracks the cash economics of prop trading: what was paid, what was refunded, what has actually been received, and what remains pending. It supports multiple firms, evaluation attempts and funded phases without seeding a firm, price list, bank connection or payout rule.

This feature is independent of market data providers. Linking a journal account provides a route to its trades; the tracker never changes fills, trade P&L, account balances, MAE/MFE or chart data.

## Research and design decisions

Research checked against public product documentation on September 7, 2026. Competitor behavior below describes documentation, not a claim that we tested their private applications.

| Source                                                                                                                                                 | Useful pattern                                                                                                        | Implementation here                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [TradeZella dashboard metrics](https://help.tradezella.com/en/articles/13463814-how-to-read-your-propfirm-dashboard-metrics-and-data-explained)        | Spend, earnings, returns, firm comparisons and account outcomes belong together.                                      | Cash totals and cumulative curve, monthly results, expense categories, firm comparisons and explicitly defined evaluation pass rate. Refunds have their own total.               |
| [TradeZella account tracking](https://help.tradezella.com/en/articles/14502950-how-to-track-your-prop-firm-accounts-in-propfirm-sync)                  | Preserve evaluation/funded phases and breached account history; associate accounts with journal records.              | Every reset or phase is a separate linked record. Archived and breached accounts retain their costs in results. Optional journal-account link.                                   |
| [TradeZella payout logging](https://help.tradezella.com/en/articles/13463717-how-to-log-a-payout-in-propfirm-sync)                                     | Attribute payouts to funded accounts and actual receipt dates.                                                        | Requests are separate from receipts; cash charts use settlement dates.                                                                                                           |
| [TradeZella manual transactions](https://help.tradezella.com/en/articles/14588595-how-to-manually-add-a-transaction-in-propfirm-sync)                  | Manual entry remains useful without a bank connection.                                                                | Manual forms and a generic CSV with validated preview. Invoice/payment references, notes and supporting attachments.                                                             |
| [Tradesyncer expense tracker](https://help.tradesyncer.com/en/articles/16102791-how-the-prop-firm-expense-tracker-works)                               | Track evaluation/funded/direct-funded/live accounts, resets, purchases and activation costs through their lifecycle.  | Evaluation, verification, funded, instant-funded and live phases; linked attempts; eight expense categories; all-time account outcomes and period cash returns.                  |
| [Topstep dashboard](https://www.topstep.com/topstep-dashboard) and [payout policy](https://help.topstep.com/en/articles/8284233-topstep-payout-policy) | Requests have operational states; payout timing, splits, caps and eligibility vary by program and account conditions. | Requested/approved/completed/rejected/cancelled states, expected date, partial receipts, overdue flags and explicit trader share/fees. No universal eligibility rule is assumed. |
| [FTMO rewards](https://ftmo.com/en/faq/how-do-i-withdraw-my-profits/)                                                                                  | Trading-account results, reward review and real withdrawals are different events.                                     | Nominal account size and trading P&L never become cash income automatically.                                                                                                     |
| [Topstep pricing questions](https://help.topstep.com/en/articles/14289835-topstep-pricing-and-payment-questions)                                       | Acquisition, recurring, reset and activation costs can all matter.                                                    | Separate expense categories and optional renewal reminders. A reminder never creates a transaction or charges money.                                                             |

The resulting design uses a cash ledger plus an account lifecycle and payout workflow. A single “payout amount” field would lose partial settlements, fees, rejected requests and reversals. Overwriting an evaluation when it resets would lose the cost of failed attempts. Summing currencies without a documented conversion would misstate results.

## Try simulated data

Choose **Load demo data** beside the CSV tools to open a read-only preview. It covers roughly 18 months across three fictional firms, USD/EUR accounts, failed and passed attempts, recurring costs, refunds, partial and completed payouts, rejected/cancelled requests, a reversal and an upcoming renewal. USD is selected initially; choose EUR or all currencies to explore the currency views. Enable **Show archived** in Accounts to see the failed first attempt.

The demo is generated in browser memory only. Charts, filters and navigation within the tracker work; financial editing, attachments and exports are disabled. **Exit demo**, refreshing or leaving the page discards the preview and returns to saved records. Demo records never enter the database, journal exports or trading metrics, and nothing loads automatically.

## Using the page

1. **Track account.** Enter your own firm and account/attempt name, currency, phase, opening date and optional nominal size. Link a journal account if useful. Add notes, rules or an upcoming renewal.
2. **Add expense.** Enter an actual charge and payment date. Assign it to an account, or keep it as a shared firm cost. Categories: evaluation, reset, activation, subscription, platform, market data, transfer and other. A free evaluation can have a zero expense.
3. **Record a refund.** In Transactions, choose **Refund** on the original expense. Multiple partial refunds are allowed up to its original amount. They reduce net spend on the dates received.
4. **Track the next attempt or phase.** Resolve the previous record as passed, breached or closed, then use **Next attempt / phase**. The form carries the firm, currency and nominal size into a new linked record; choose the new program and name. It does not automatically close or alter the prior record. Only evaluation and verification phases can be marked passed.
5. **Track payout.** Select a funded, instant-funded or live account. Enter the request date, requested gross amount, trader percentage, known withheld fees and optional expected payment date. If the amount already reflects the trader split, enter 100% to avoid deducting it again.
6. **Record receipt.** When money arrives, record the actual net amount and settlement date. Several payments can belong to one payout. A bank return is a dated reversal. Once the final payment arrives, edit the payout to Completed; any difference from the estimate remains visible.
7. **Keep evidence.** Details supports images/PDFs for accounts and entries. Attach payout confirmations or bank evidence to the payout, and invoices to expenses. References and notes can distinguish each partial receipt.
8. **Correct records.** Edits require a reason. Void duplicates or incorrect receipts and replace them; restore a void if needed. Archive old accounts to reduce clutter while preserving their history and contribution to cash returns.

The page has **Overview**, **Accounts**, **Payouts** and **Transactions** views. Filters cover firm, account, currency and dates; lists also have search. Journal trade filters are separate because a trade's execution date and a payment's settlement date need not match.

The overview leads with **Money spent**, **Payouts received** and **Net after costs**. Refunds and net cost sit directly beneath spending. Pending requests have a separate “Awaiting payout” row and do not count as received cash. The monthly **Spending vs payouts** chart compares actual payments and receipts; its tooltip also includes refunds and net results.

Expand **Filters** to change firm, account, currency or dates. **Detailed breakdowns** retains the cumulative net cash chart, firm returns, expense categories, account progress, renewals and the full monthly table. CSV import/export is under **Data tools**. These presentation changes do not alter any calculations or stored records.

## Metric contract

All money is stored in integer currency minor units. Decimal input is validated against the currency's precision; excessive decimal places are rejected, never silently rounded. Trader percentages use basis points. Expected payout share rounds half up to the currency's minor unit.

| Metric                   | Definition                                                                                                                                                                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spent                    | Sum of nonvoid actual expense charges within the cash date range.                                                                                                                                                                                   |
| Refunds                  | Sum of nonvoid expense refunds received within the range.                                                                                                                                                                                           |
| Net spend                | Spent minus refunds.                                                                                                                                                                                                                                |
| Payouts received         | Actual receipt amounts minus actual reversals in the range. Requests and approvals contribute zero.                                                                                                                                                 |
| Net cash                 | Payouts received plus refunds minus spent.                                                                                                                                                                                                          |
| Cash ROI                 | Net cash / net spend × 100, only when net spend is positive. This is cash return on fees, not return on nominal funded capital.                                                                                                                     |
| Expected net payout      | Round(requested amount × trader share) minus expected withheld fees. This is an estimate until settled.                                                                                                                                             |
| Outstanding              | Sum of max(expected net minus net receipts, 0) for requested or approved payouts. Completed/rejected/cancelled requests have no outstanding balance.                                                                                                |
| Settlement variance      | Actual net receipts minus expected net payout. A completed short payment remains visible as a negative variance.                                                                                                                                    |
| Overdue                  | An open request with an expected date before today and a positive unpaid expected amount.                                                                                                                                                           |
| Partial                  | An open payout with positive receipts below the expected net amount.                                                                                                                                                                                |
| Resolved phase pass rate | Passed evaluation/verification records / (passed + breached evaluation/verification records). Active and voluntarily closed phases are excluded. Each phase counts separately; this is not the percentage of original purchases that became funded. |

Cash charts and monthly summaries use payment/refund/receipt/reversal dates and begin at zero for the selected period. A prior year's expense with a current-year refund therefore affects different periods. ROI may be unavailable when a period contains more refunds than new charges; choose all dates to inspect lifetime cash returns. The chart is a cumulative cash-flow curve, not a bank balance.

Open payout balances and renewal reminders use all dates so an older pending request remains visible while viewing this month's cash. Closed payout rows use their request dates. The Ledger date filter also uses request dates for payout records and payment dates for expenses/refunds; its explanatory copy distinguishes requests from actual income.

Account status and pass-rate counts reflect current lifetime records, not status snapshots at the range end. Archiving only affects the account list; it never removes prior costs or payouts from results. Shared firm expenses are included in firm/overall totals and excluded when filtering to a specific account.

Currencies remain separate. With multiple currencies, the overview shows a net figure for each and requires a currency selection for consolidated cards and charts. No exchange rate or combined currency total is invented. Receipts use their payout currency; where a bank converted the payment, enter its evidenced original-currency amount. Automatic FX reconciliation is not part of this release.

Example: spend $150, receive a $50 fee refund, request $1,000 at a 90% trader share with $10 withheld. Expected payout is $890. Receive $400 and then $490: outstanding moves from $890 to $490 to $0. Lifetime net cash is $790 and cash ROI is 790%. A later $90 reversal lowers net receipts to $800 and net cash to $700 on the reversal date. If an already-completed payout needs further payment, reopen its status to Approved to track that outstanding amount.

## CSV import and export

Download **Data tools → Import CSV → header template** from the page (`/prop-cash-template.csv`). It contains only generic headers:

```csv
id,kind,firm,account_id,currency,date,amount,category,expense_id,reference,notes
```

- `id`: a stable unique transaction ID, 1 to 100 letters, digits, underscores or hyphens. Retain it when re-importing. IDs must be unique across imports, so prefix IDs from different files/systems when needed.
- `kind`: `expense`, `refund` or `payout`. A CSV payout means **actual net money already received**, not a pending request. It creates a completed payout and matching receipt at 100% share and zero additional fee.
- `firm`: your own firm name; for an account-linked row it must match that account exactly.
- `account_id`: copy from account Details. Required for payouts. Expenses can leave it blank for shared firm costs; refunds must match the original expense's account.
- `currency`: a supported uppercase three-letter currency code matching the account, when linked.
- `date`: real payment date in `YYYY-MM-DD`, no future dates. Dates cannot precede account opening.
- `amount`: positive decimal cash amount in that currency; zero is allowed only for expenses. Do not use symbols, grouping separators or signed values.
- `category`: required for expenses, using one of the category identifiers above (`market_data` for market data). Ignored for refunds/payouts.
- `expense_id`: required for refunds; the original expense's CSV ID or its saved entry ID. Put new expense rows before their refunds.
- `reference`, `notes`: optional invoice/bank reference and context.

Preview validates the whole file, shows counts and the first five rows, and rolls back all database changes. Import validates again and commits all valid rows atomically. Any invalid row rejects the whole batch. A repeat ID with the same original data is skipped, even if the saved entry was subsequently corrected or voided. Reusing it with different CSV data is an error. A different ID is treated as a different transaction, so do not give duplicate statements new IDs.

Maximum file size is 2 MB, with 1,000 rows per batch. Convert a bank or firm export to this documented schema first; this release does not claim to recognize arbitrary bank CSVs. Pending payout requests and reversals use the manual forms.

**Export cash CSV** downloads the filtered actual cash movements, including reversals, with their entry/account IDs and references. It is an analysis export with a different schema from the import template. **Settings → Data & backups → Full backup (JSON)** includes all prop accounts, entries, receipts and the complete audit trail, including archived/voided records. Attachment metadata is included; the attachment binaries require the existing full data-directory backup. JSON is an export format; this release does not add a general backup-restore importer.

## Implementation and reliability

- Four additive SQLite tables: `prop_accounts`, `prop_entries`, `prop_receipts`, `prop_audit`. Foreign keys protect account/entry relationships; removing a linked journal account clears the optional link without deleting prop history.
- All mutations are transactions. Server validation enforces currency, amount, status, date, lineage, refund and receipt constraints independently of the UI.
- Account and entry revisions prevent stale edits overwriting another view's changes. Receipt mutations also increment/check the parent payout revision. New-record requests carry stable IDs for safe retry.
- Refunds cannot exceed the original charge. An expense with active refunds cannot be voided. Receipt corrections cannot produce a negative received balance at any historical date. A paid payout cannot be cancelled/rejected while it retains net cash receipts.
- Voiding is reversible and audited. Nothing in the tracker hard-deletes financial records. The history UI loads the latest 100 changes on demand; full history stays in the database/export.
- Authentication uses the journal's existing password/session gate. Responses are private/no-store. No external service, trading API or bank is contacted by tracker operations.
- Privacy mode masks money and removes financial charts/details; editing and cash export are disabled until privacy mode is turned off.
- Initial data loads only on this page. Calculations use memoized data and receipt maps; currency formatters are reused. Lists render 40 rows per page, audit history is loaded on demand, and binary attachments are not included in the tracker response. Limits are 2,000 accounts, 20,000 entries and 50,000 receipts; these are validation ceilings, not a claim of measured UI performance at maximum size.
- Focused tests cover precision, dated cash flows, partial receipts/reversals, status transitions, refund caps, lineage, archive/void/restore behavior, optimistic concurrency, retries, authenticated APIs, atomic CSV preview/import and export exclusions.

## Extension boundaries

The local tracker is usable without any external connection. The following would be separate additions, rather than implied behavior in this version:

1. **Bank/firm connectors and matching.** Stage imported transactions, preserve source identifiers, review uncertain matches, and reconcile to the existing ledger. Use provider adapters; retain manual entry as an equal option. A broker's fills endpoint alone is insufficient evidence of a bank payout.
2. **FX settlement reconciliation.** Store original currency, settlement currency, evidenced conversion rate/date and fees as separate facts. Add an explicit reporting currency and conversion method before offering combined returns.
3. **Versioned program rules and eligibility.** Model program/rule effective dates, account vintage, payout windows, splits, caps, buffers and consistency requirements. Compute eligibility only with complete confirmed inputs. Until then, users keep account-specific rules in notes and consult their firm's current terms.
4. **Scheduled renewal/payout notifications.** The current dashboard shows reminders while open. Background/email notifications would need user opt-in, timezone-aware scheduling and delivery preferences.
5. **Longer-term analytics and scale.** Add acquisition-cohort returns and time-to-funding, distinguish phase passes from complete challenge outcomes, and move filters/aggregates to indexed SQL before promising very large portfolios. Keep each metric's denominator and date basis visible.

These boundaries prevent “expected,” “eligible,” “approved” and “received” from becoming interchangeable as integrations are added.
