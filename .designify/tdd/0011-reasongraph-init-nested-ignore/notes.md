# RFC 0011 TDD notes

Seam: `init()` in a temporary Git repository, observed through generated files and Git status.

RED: Assert shared init creates the nested allowlist, preserves root `.gitignore`, preserves an existing nested ignore file, and leaves the file stable on repeated init. Assert self-only init creates no nested ignore file.

RED command: `pnpm --filter @borg0ai/reasongraph exec vitest run test/selfonly.test.ts`

RED result: 18 passed, 1 failed. `root gitignore is untouched` failed because init appended `# ReasonGraph local state (per-machine)` and `.reasongraph/state/` to the root file.

GREEN focused command: `pnpm --filter @borg0ai/reasongraph exec vitest run test/selfonly.test.ts`

GREEN focused result: 19 tests passed.

Full validation:

- `pnpm --filter @borg0ai/reasongraph test`: 20 files, 123 tests passed; pretest Vite build passed.
- `pnpm --filter @borg0ai/reasongraph typecheck`: passed.
- `git diff --check`: passed.
