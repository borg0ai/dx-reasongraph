# Contributing

Thanks for helping out. The bar for a change is simple: **`pnpm test` stays green, and new
behavior comes with a test.**

## Setup

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test          # runs the apps/cli Vitest suite
```

Requirements: **Node >= 20.19** and **git** on your PATH. The CLI has zero runtime
dependencies; Vite, Vitest, and TypeScript are development dependencies.

## The tests are hermetic — they run anywhere

You do **not** need Claude, an API key, a network connection, or any of your own Claude
sessions to run the suite. Specifically:

- The LLM is always a **mock backend** (`test/helpers.ts`) that returns canned JSON — no
  `claude -p`, no `ANTHROPIC_API_KEY`, no network.
- Tests that need a git repo create a **throwaway temp repo** and set their own
  `user.email`/`user.name` locally, so they don't touch or depend on your global git identity.
- Fixtures (`test/fixtures/*.jsonl`) are committed, so parsing tests are deterministic.
- No test reads your real `~/.claude` transcripts or any absolute machine path.

CI (`.github/workflows/ci.yml`) runs typecheck, build, and Vitest on Node 20 and 22
(Linux) plus Node 22 on Windows.

## Layout

- `apps/cli/src/` — CLI source, adapters, distiller, and commands.
- `apps/cli/test/` — Vitest suites, helpers, and fixtures.
- `reasongraph/` — independently installed agent hooks and skill.
- `docs/` — architecture, format, privacy, config (start with `docs/HOW-IT-WORKS.md`).

Adding support for another agent tool (e.g. Codex) is the most-wanted contribution: the
write-side adapter interface (`apps/cli/src/adapters/types.ts`) and the read-side pointer/hook pattern
are both per-tool seams over a universal markdown format, so it's an additive change.

## A note on the `reasongraph: update why-pack` commits

This repo dogfoods itself, so its own git hooks may auto-commit `.ai/why/main.md` in a separate
commit titled `reasongraph: update why-pack (main)`. Those are tool-authored and safe to rebase
past or drop — don't amend them into your feature commits, and don't hand-edit `.ai/why/`
unless that's the point of your change.
