# Contributing

Thanks for helping build the open trade journal.

## Setup

```bash
pnpm install
pnpm dev          # app on :3000
pnpm test         # vitest (packages/core, packages/importers)
pnpm typecheck    # all packages
pnpm format       # prettier
```

## The gates

CI runs `pnpm format:check`, `pnpm typecheck`, `pnpm test`, and `pnpm build`. Run them
locally before pushing.

## Ground rules

- **Broker connectivity goes through `@luxalgo/broker-sdk` — never direct broker API
  code here.** Missing something? Propose it against
  [broker-sdk](https://github.com/LuxAlgo/broker-sdk) instead of working around it.
- **Analytics live in `packages/core`** as pure, unit-tested functions. The app renders;
  it doesn't compute.
- **Tests defend product invariants, not implementations.** Titles read as plain
  product statements ("a fill that crosses through flat splits into two trades").
- **Importers never guess.** A file either matches a documented signature or goes to
  the column mapper. New formats need a fixture test — real anonymized exports are the
  most valuable contribution this repo can receive (see docs/importers.md).
- **P&L color is never load-bearing** — see docs/design.md before touching charts.
- No telemetry. No hosted-service assumptions. Keys stay on the user's machine.
