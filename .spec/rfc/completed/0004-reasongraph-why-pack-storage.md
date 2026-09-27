# RFC 0004: Move why-packs into .reasongraph/why

**Status:** Implemented

## Summary

Move committed branch why-packs from `.ai/why/` to `.reasongraph/why/`. Make
`.reasongraph/` the sole ReasonGraph-owned repository directory for config and
decision history, while keeping machine-local state under its existing ignored
`state/` subdirectory.

## Problem

RFC 0001–0003 established `.reasongraph/` as the repository seed, but the
implementation still routes every why-pack read, write, and Git operation
through `.ai/why/`. That leaves ReasonGraph data split across two roots and
means `init` does not seed the directory named by the product.

## Goals

* Store shared and self-only why-packs under `.reasongraph/why/`.
* Make init, distillation, context lookup, hook injection, sync, status,
  doctor, and auto-commit use the new path.
* Migrate existing `.ai/why/` packs once, without overwriting destination data.
* Update the plugin skill, managed `AGENTS.md` pointer, docs, and tests so the
  documented path matches runtime behavior.
* Stop reading or writing `.ai/why/` after migration.

## Non-goals

* Changing why-pack Markdown format or distillation behavior.
* Changing the CLI package or plugin install flow.
* Supporting ongoing dual-read or dual-write behavior for `.ai/why/`.

## Design

`apps/cli/src/util/paths.ts` will define `whyDir` as
`.reasongraph/why/`. All runtime code will consume that path instead of
embedding `.ai/why/` in Git commands or display strings. Init will create the
directory in shared and self-only modes.

On init, migrate legacy Markdown packs only when `.reasongraph/why/` has no
conflicting filenames. Preflight collisions before moving anything; if any
collision exists, leave both directories untouched and fail with the conflicting
paths so a human can resolve them. In shared mode, move packs and remove the
old placeholder directory when empty. In self-only mode, copy packs into the
private ignored destination and leave shared source files untouched. No runtime
fallback to the old directory remains.

Update auto-commit path filters, config comments, status/doctor/init output,
uninstall messaging, docs, tests, and the root plugin skill. Preserve unrelated
`.ai/` content. The plugin remains under repository-root `reasongraph/` and the
CLI remains under `apps/cli/`.

## Acceptance

* Vitest proves path construction, shared migration, self-only copy, collision
  safety, and that context/hook/distill/autocommit operate under
  `.reasongraph/why/`.
* CLI init seeds `.reasongraph/config.json`, `.reasongraph/why/`, and ignored
  `.reasongraph/state/`; no normal runtime operation reads or writes
  `.ai/why/`.
* Root plugin skill and user docs point to `.reasongraph/why/`.
* `pnpm --filter @borg0ai/reasongraph test`, typecheck, build, package dry run,
  and `specify sync-check` pass.
