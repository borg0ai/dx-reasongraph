# RFC 0009: Improve init command progress and output

**Status:** Implemented

## Summary

Give `reasongraph init` a clear, friendly progress log for repository setup and prior-session backfill. Use color only when terminal output supports it, preserve readable plain output for pipes and CI, and report completed work rather than guessed percentages.

## Problem

`init` currently performs migration, directory creation, config writes, instruction-file updates, and Git-hook installation before printing one large summary. Users get no indication which setup work completed if a later step fails. The optional prior-session scan and backfill can also take time, while output does not consistently distinguish progress, success, and warnings. This makes first-run behavior harder to follow and diagnose.

## Goals

- Show concise progress through the actual `init` setup stages.
- Make success, skipped work, and warnings easy to distinguish.
- Use ANSI color only for an interactive terminal when `NO_COLOR` is unset.
- Keep non-interactive output useful and free of escape sequences.
- Preserve existing init behavior, data writes, backfill prompt defaults, and exit codes.

## Non-goals

- Changing what `init` creates, migrates, or commits.
- Changing plugin installation; `reasongraph install` remains separate.
- Adding a runtime dependency solely for terminal formatting.
- Showing elapsed-time estimates or percentages without measured work totals.
- Redesigning output for commands other than `init`.

## Design

Add a small output formatter to the existing CLI logging utility, without a new dependency. Detect color support from stdout TTY state and `NO_COLOR`; keep normal messages on stdout and warnings on stderr. The formatter must have a plain-text mode so output remains readable in CI, redirected output, and tests.

Have `init` report named setup stages as they complete: legacy why-pack migration, directory setup, shared or self-only configuration, `AGENTS.md` pointer handling, and pre-push hook handling. Print an initial setup heading and a final concise result; retain the existing detail about files, privacy mode, and next steps. Report a failed stage through the current warning/error path before returning its existing exit code.

Announce prior-session discovery before scanning. Keep the existing default-No prompt and backfill behavior. During backfill, rely on the distill command's per-session result output; do not add fake percentages, ETAs, or an animated spinner that would corrupt redirected logs. Limit implementation to `apps/cli/src/commands/init.ts`, the shared output utility, and focused CLI tests.

## Acceptance

- Interactive init shows ordered stage progress and a clear completion result; success and warning states are visually distinct.
- Non-TTY output and output with `NO_COLOR` contain no ANSI escape sequences and retain all actionable messages.
- Shared and `--self-only` modes report their own actual setup results, including skipped `AGENTS.md` work and existing hook/config states.
- Migration conflict still returns failure and clearly identifies the failed migration without claiming init completed.
- Backfill discovery, default-No prompt, and distill results remain understandable; declining backfill still succeeds, and accepted backfill preserves current exit behavior.
- Existing initialization behavior and idempotency remain unchanged; focused Vitest coverage verifies output modes and stage outcomes.
