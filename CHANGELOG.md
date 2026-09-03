# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- Password protection now verifies the session signature on every API route. Previously, when `JOURNAL_PASSWORD` was set, any request carrying a cookie of the right name was accepted, so a forged cookie could read the journal.

## [0.1.0] - 2026-09-03

Initial public release.

### Added

- Round-trip engine: flat-to-flat position cycles from raw fills, FIFO/LIFO/weighted-average matching, partial fills, position flips, futures multipliers, rebuild-stable annotation keys (`@luxalgo/journal-core`)
- Analytics: P&L, win and day-win rates, profit factor, expectancy, R multiples, streaks, drawdown and recovery, profit concentration, calendar and bucket aggregations, the open Edge Score
- Statement importers with auto-detection for 12 formats, one-click TradeZella/Tradervue migration with exact P&L reconciliation, and a column mapper for anything else (`@luxalgo/journal-importers`)
- Web app: dashboard, P&L calendar, daily journal with voice dictation, trades table, trade pages with charting, notebook, playbooks, reports
- Broker sync via `@luxalgo/broker-sdk` with credentials encrypted at rest
- Optional AI reflection (bring your own Anthropic API key): session recaps, trade critiques, ask-your-journal
- Docker deployment, optional password auth, full JSON/CSV export
