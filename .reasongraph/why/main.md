# Why: main

<!-- reasongraph:v1 generated 2026-10-24 — review before sharing; edit freely, edits are preserved -->

## Intent
Attribute each transcript to the adapter that owns its path, and stop marking a distill finished when a non-empty read yields no events.

## Decisions

### Read the CLI version from the package.json beside the real entry path
Status: discussed
Touches: `apps/cli/src/cli.ts`, `apps/cli/vite.config.ts`, `apps/cli/package.json`, `apps/cli/dist/cli.js`

The reported version has to come from the package.json next to the real bundled entry. Vite define inlines __REASONGRAPH_VERSION__ at build time, and the published 0.1.2 tarball's dist hardcodes 0.1.1 (70555 bytes) while that tag's apps/cli package.json version is 0.1.2. dist is gitignored, so a pack of a bundle built against the previous version ships a stale literal and -v disagrees with the installed manifest. The working tree drops the define and reads ../package.json from dist/cli.js at runtime; that local bundle is 70742 bytes and reports 0.1.2.

Considered/rejected: Leaving the Vite define in place only stays correct if every publish rebuilds after the version bump. The 0.1.2 registry dist shows that did not happen: the baked literal stayed 0.1.1.
Risk: The bundle can rewrite the package.json lookup onto process.argv[1]. If that path is a bin symlink rather than the real dist/cli.js, ../package.json is not the package root and -v can read the wrong file.
Reviewer attention: Confirm vite.config.ts no longer defines __REASONGRAPH_VERSION__, and that -v on an installed copy matches that copy's package.json when the binary is reached through a symlink.

### Select the transcript adapter from path ownership
Status: directed
Touches: `apps/cli/src/adapters/types.ts`, `apps/cli/src/adapters/index.ts`, `apps/cli/src/adapters/jsonl.ts`, `apps/cli/src/adapters/claude-code.ts`, `apps/cli/src/adapters/codex.ts`, `apps/cli/src/adapters/cursor-agent.ts`, `apps/cli/src/adapters/opencode.ts`, `apps/cli/src/commands/hook.ts`, `apps/cli/src/core/sessionTool.ts`

Stop and SessionEnd stored `tool: "claude-code"` for every `transcript_path`, so `distillSession` always ran `ClaudeCodeAdapter.normalizeEvents`. That parser keeps only Claude `user`/`assistant` records with `message.content` and looks for `gitBranch` plus Claude `tool_use` paths, so a Codex rollout of `session_meta`, `event_msg`, `response_item`, and `turn_context` (4805 lines on the sealed session) produced zero events, empty `files_touched`, and empty `branches_seen`. `CodexAdapter` already understands `response_item` messages, reasoning, and function calls; the miss was adapter selection. Each adapter now implements `ownsTranscript`, and `toolForTranscript` maps a rollout under `~/.codex/sessions` to `codex`, an `agent-transcripts` JSONL to `cursor-agent`, `opencode.db` to `opencode`, and a file under `~/.claude/projects` to `claude-code`. `hookStop` and `hookSessionEnd` persist that tool.

Considered/rejected: Teaching ClaudeCodeAdapter to parse Codex records was rejected because the Codex parser already existed and the stored tool never selected it.
Risk: An already installed hook binary keeps the hardcoded `claude-code` stamp until this CLI is rebuilt.
Reviewer attention: Confirm the four path rules and that both hooks call `toolForTranscript` instead of writing a constant tool name.

### Skip session creation when no adapter owns the path
Status: directed
Touches: `apps/cli/src/core/sessionTool.ts`, `apps/cli/src/commands/hook.ts`

An unrecognized transcript path must not be recorded. `toolForTranscript` returns no tool for those paths, and the hooks create no session, so the file cannot be sealed under a parser that will drop every line.

Reviewer attention: Confirm an unknown path does not upsert a session record.

### Rewind offset and mark dirty when the stored tool does not own the path
Status: directed
Touches: `apps/cli/src/core/sweep.ts`, `apps/cli/src/state/state.ts`, `apps/cli/src/core/distillSession.ts`

If a session row already exists, discovery used to refresh only `transcript_path`, so a wrong tool stayed forever. A Codex session had already been marked `distilled` at offset `16359116` (end of file); later sweeps then logged no changes. When the stored tool does not own the path, `discoverAndSync`, `distillSession`, and `upsertSession` (on a hook tool update) switch the tool, set the offset back to `0`, and set status to `dirty`, which unseals that session for another distill.

Reviewer attention: Confirm a tool correction resets the offset to 0 rather than continuing from the previous end-of-file cursor.

### Keep a non-empty zero-event read dirty and do not advance its offset
Status: directed
Touches: `apps/cli/src/core/distillSession.ts`, `apps/cli/src/distiller/index.ts`

`distillEvents` returns `ok: true` and `emptyPack()` when the event list is empty, and `renderPack` writes the placeholder `_No decisions recorded yet._`. That path treated a bad parse as a clean finish: the offset jumped to EOF and status became `distilled`. A read with non-empty bytes whose `normalizeEvents` still returns nothing now leaves the offset unchanged and the status `dirty`.

Considered/rejected: Sealing `ok: true` plus an empty pack was rejected because the cursor at EOF makes every later distill report no changes.
Reviewer attention: Confirm the guard is the non-empty byte check in `distillSession`, and that a zero-event result does not move the offset or set `distilled`.

### Specify the attribution fix as RFC 0008 and mark it implemented
Status: discussed
Touches: `.spec/rfc/completed/0008-transcript-tool-attribution.md`, `.spec/TASK_TRACKING.md`, `apps/cli/src/core/sessionTool.ts`

RFC 0008 is the transcript-ownership fix and is marked implemented, not left as an open design. The workspace copy was committed as 9d67e02 with message fix(cli): attribute transcripts to the owning adapter, covering 17 files (the RFC, adapter ownership, hook selection, offset rewind, and tests).

### Lock path ownership and rewind behavior in CLI tests
Status: directed
Touches: `apps/cli/test/transcriptTool.test.ts`, `apps/cli/test/state.test.ts`

Path ownership and the session rewind are covered by new tests in `transcriptTool.test.ts` and updates in `state.test.ts`. The package test run, including `agentAdapters.test.ts` and `distillSession.test.ts`, reported 99 tests passed.

Reviewer attention: Confirm the new tests cover an unknown path, each owned layout, a tool mismatch that rewinds offset to 0, and a non-empty zero-event read that stays dirty.

### Skip a failed distiller chunk without logging the backend error
Status: discussed
Touches: `apps/cli/src/distiller/index.ts`, `.reasongraph/state/logs/distill.log`

A failed model chunk is counted and skipped without recording the child process stderr or exit code. When every chunk fails, the command prints only that all chunks failed. A direct claude -p --model haiku run exited 1 because the Claude session limit was already hit, but that reason never appeared in the distill summary, so the run looked like the earlier empty-transcript attribution bug. The session stayed dirty with the offset left at 0 so a later distill retries from the start. The PATH reasongraph binary at 0.1.3 still did this, because that build only invokes claude -p and does not read distiller.backend.

### Select the distiller backend by CLI name
Status: directed
Touches: `apps/cli/src/util/config.ts`, `apps/cli/src/distiller/backends.ts`, `apps/cli/src/distiller/index.ts`, `docs/config.md`, `.reasongraph/config.json`

distiller.backend chooses which local binary runs a chunk. The allowed values are the CLI names claude, agent, and codex. The Cursor backend id is agent, matching the agent binary, rather than cursor or cursor-agent. This landed on main as b9a62e8, feat(cli): distill with claude, agent, or codex.

Considered/rejected: A Claude-only claude -p backend, and a backend id of cursor that invoked cursor-agent. Claude-only distillation exited 1 on every chunk once the Claude session limit was hit, with no separate quota for the other CLIs.
Risk: The reasongraph binary on PATH was still 0.1.3. That build ignores distiller.backend and distiller.models and always runs claude -p, so a distill from that shim still fails every chunk while the session limit holds.
Reviewer attention: Confirm installed and published CLIs are this build, not 0.1.3, before expecting backend to switch the process. Confirm the config union is only claude, agent, and codex.

### Drop API providers and API-key checks
Status: directed
Touches: `apps/cli/src/distiller/backends.ts`, `apps/cli/src/commands/doctor.ts`, `apps/cli/src/util/config.ts`, `docs/config.md`

The distiller does not call an API provider and does not read API keys. Login and quota failures are left to the selected CLI. doctor follows that same rule and does not inspect a key.

Considered/rejected: An API fallback when ANTHROPIC_API_KEY was set, and in-process key checks in doctor. A Vite production bundle had also compiled a direct process.env read into an empty object, so key inspection inside the bundled doctor was unreliable; that path was removed instead of kept behind an indirect env read.

### Pass only the model bound to the selected CLI
Status: directed
Touches: `apps/cli/src/util/config.ts`, `apps/cli/src/distiller/backends.ts`, `apps/cli/src/commands/doctor.ts`, `docs/config.md`, `.reasongraph/config.json`, `.reasongraph/state/config.json`

distiller.models is a map with one string per CLI (claude, agent, codex). The running backend receives only its own entry, unchanged, on that CLI's model flag. The configured values were claude haiku, agent auto, and codex gpt-6-luna. auto is the agent CLI's default model name; gpt-6-luna was taken from the local Codex config. doctor reports the selected CLI's model.

Considered/rejected: One shared model string (haiku) passed through no matter which CLI was selected.
Reviewer attention: Confirm gpt-6-luna is an acceptable shared default and not only a machine-local Codex setting.

### Invoke each distiller CLI with its native headless flags
Status: discussed — binary names were specified; ask mode and the read-only sandbox were chosen while wiring them
Touches: `apps/cli/src/distiller/backends.ts`, `apps/cli/test/backends.test.ts`

claude is invoked as claude -p --model. agent is invoked as agent -p --mode ask --model so the distill stays read-only. codex is invoked as codex exec -m inside a read-only sandbox. apps/cli/test/backends.test.ts locks those argv shapes. The full suite later reported 104 passed tests.

### Set local distiller configs to the agent CLI
Status: directed
Touches: `.reasongraph/config.json`, `.reasongraph/state/config.json`, `/Volumes/ORICO/ws/prj/skills/archify/.reasongraph/state/config.json`, `.reasongraph/why/main.md`

This repo's shared config and state config, and the archify checkout's state config, were set to backend agent and models.agent auto so distillation would stop calling claude. Dogfood through the repo-built CLI (node apps/cli/dist/cli.js), not the 0.1.3 shim, distilled session 15d26749-73f7-4be8-83de-2410b7217c03 (about 66KB) and added 8 decisions to .reasongraph/why/main.md. That why-pack update was pushed as 1fcc9ae, separate from the CLI commit b9a62e8.

Reviewer attention: Confirm the why-pack commit 1fcc9ae is intended on main, and that the archify state config change belongs outside this repo's commit.

### Drop the previous name with no compatibility aliases or fallback paths
Status: directed
Touches: `apps/cli/**`, `reasongraph/**`, `.reasongraph/**`, `AGENTS.md`

The package, bin, source symbols, env names, generated markers, docs, and on-disk paths all use reasongraph. The previous command alias, shared config filename, and machine state directory are removed rather than kept as readers. Data directories are renamed in place; commit history is left unrewritten, so older titles can still contain the previous name.

Considered/rejected: Keeping a second bin alias plus read fallbacks for the old shared config and machine state was rejected because it left the previous name in the live interface.
Risk: Checkouts and scripts that still call the old bin or read the old config and state paths stop resolving them.
Reviewer attention: Confirm a worktree scan has no remaining previous brand strings, and that git history was intentionally not rewritten.

### Move the CLI into apps/cli as a scoped package
Status: directed
Touches: `apps/cli/package.json`, `apps/cli/src/**`, `package.json`

The repository root is the monorepo development surface. CLI implementation and the publishable package live under apps/cli, with package name @borg0ai/reasongraph and bin reasongraph. Root scripts do not publish the plugin or the old package layout.

Reviewer attention: Confirm the published name, bin, and files field point only at the CLI package.

### Build the CLI with a Vite custom entry
Status: discussed — library mode was not a usable CLI build
Touches: `apps/cli/vite.config.ts`, `apps/cli/dist/cli.js`

Vite library mode tree-shook the process entry and emitted a 20-byte shebang, so the CLI is bundled as a custom entry rather than an exported library. The built file is what --help and init smoke checks run.

Considered/rejected: Vite library mode was rejected because it dropped the side-effect startup code.
Risk: Switching the build back to library mode would ship a non-executable binary again.

### Keep the agent plugin at the repository root and out of the CLI tarball
Status: directed
Touches: `reasongraph/**`, `apps/cli/package.json`

Hooks and the skill stay in the repository-root reasongraph directory, not under plugins/ and not inside the CLI package. npm pack dry-run shows the tarball contains dist/cli.js, README, LICENSE, and package metadata only; tests and the root plugin are excluded.

Considered/rejected: A plugins/ subdirectory and shipping hooks and skill inside the CLI package were both rejected.
Reviewer attention: Confirm the packed file list still excludes reasongraph/ and the test tree.

### Install the plugin only with the Vercel plugins CLI
Status: directed
Touches: `apps/cli/src/**`, `reasongraph/hooks/**`, `reasongraph/skills/**`

reasongraph install runs npx plugins add against borg0ai/dx-reasongraph with project scope and does not call init. That CLI recursively scans two levels from the repository root, so the plugin remains reasongraph/ with root-level hooks and skills. discover . found that plugin with 1 skill and hooks. No .plugin/plugin.json manifest is part of the layout.

Considered/rejected: npx skills add, an in-package directory as the install source, and a .plugin/plugin.json manifest were rejected.
Reviewer attention: Confirm install arguments are the repository slug plus project scope, not a path inside apps/cli.

### Limit init to seeding the repository
Status: directed
Touches: `apps/cli/src/**`, `.reasongraph/config.json`, `.reasongraph/state/**`

init writes the repository seed, including .reasongraph/config.json, local state under .reasongraph/state, and the Git pre-push hook whose fallback points at the packaged CLI. It does not install the agent plugin and does not chain into install. Agent hook registration is left to the plugin so the same hooks are not installed twice.

Considered/rejected: An install command that implicitly ran init, and init writing host settings hooks, were removed.

### Write the shared instruction pointer into AGENTS.md
Status: directed
Touches: `AGENTS.md`, `apps/cli/src/**`

init refreshes a managed block in the existing AGENTS.md and does not create CLAUDE.md. Doctor, uninstall, README, and tests follow that pointer. A self-only init does not write the shared instruction file.

Considered/rejected: Creating or updating CLAUDE.md as the instruction pointer was removed.
Reviewer attention: Confirm init on this repo updates only the AGENTS.md managed block and leaves no CLAUDE.md.

### Call context and sync from the plugin skill
Status: directed
Touches: `reasongraph/skills/**`

The skill uses the reasongraph CLI: context before an edit to read related decisions, and sync after an important decision to persist the rationale. The skill is installed by the plugins CLI; it is not a second copy of the CLI inside the plugin.

Reviewer attention: Confirm the skill invokes the scoped CLI commands rather than a local unpacked script.

### Run CLI tests with Vitest inside the CLI package
Status: directed
Touches: `apps/cli/**`, `reasongraph/**`

CLI tests moved into apps/cli and run under Vitest. Assertions that cover the root reasongraph plugin contents stay outside that package. The CLI suite was 86/86 after the package split.

Reviewer attention: Confirm plugin-content tests still target the repository-root reasongraph directory.

### Link the workspace CLI with pnpm and defer registry publish
Status: directed
Touches: `apps/cli/package.json`, `apps/cli/dist/cli.js`

The global shim has to point at a freshly built apps/cli/dist/cli.js. A root pnpm build produced that file at 69.55 kB. pnpm link --global only works when run from the apps/cli package directory; combining --filter with link conflicts, so the filter invocation cannot create the shim. After the link, later root builds replace dist/cli.js and the existing global shim keeps resolving to it. A registry install is a separate artifact and drops that workspace link.

Considered/rejected: pnpm --filter on the CLI package plus link --global was tried and does not link, because filter and link conflict. A global add of the scoped package also failed to resolve, so it does not replace the workspace link.
Reviewer attention: Confirm the global reasongraph shim resolves to apps/cli/dist/cli.js and that a later pnpm build updates that file without relinking.

### Store why-packs under .reasongraph/why
Status: directed
Touches: `apps/cli/src/**`, `.reasongraph/why/**`, `.ai/why/**`

The live why-pack directory is .reasongraph/why, including .reasongraph/why/main.md, which status reads. Docs, the AGENTS pointer, the plugin skill, and Git paths use that directory. .ai/why remains only as a one-time migration source; if migration would overwrite existing files, init stops. After the move, Vitest was 89/89.

Considered/rejected: Keeping .ai/why as the only read and write directory was rejected.
Risk: Writers that still target .ai/why diverge until the one-time migration runs, and a conflict aborts init instead of merging.

### Specify the why-pack move as RFC 0004 and mark it implemented
Status: discussed
Touches: `.spec/rfc/completed/0004-reasongraph-why-pack-storage.md`

The storage move is outside the three already archived RFCs, so it is specified separately as RFC 0004, covering the new directory, one-time migration, and conflict stop. It is archived as Implemented after the path switch, and Specify sync-check passed.

### Archive the CLI, publish, and plugin RFCs as implemented
Status: directed
Touches: `.spec/rfc/**`, `.spec/**`

Package placement, Vite and Vitest, tag-triggered publish, the init versus install split, and the skill-to-CLI loop are specified as an umbrella plus two child RFCs and archived as RFC 0001–0003 Implemented. Specify link checks and sync-check passed. Implementation was not left at the chat draft.

Considered/rejected: One RFC covering package publish and the plugin loop together was the alternative; separate child RFCs keep one concern each.
Reviewer attention: Confirm RFC 0001–0003 status is Implemented and matches the apps/cli versus root-plugin boundary.

### Record the storage boundary with Birdify outside the product
Status: directed
Touches: `.birdify/architecture.json`

Birdify records the why-pack storage boundary in .birdify/architecture.json. It is an external architecture log, not a ReasonGraph command or packaged feature. Invocation goes through npx so the tool manages its own cache.

Considered/rejected: Treating Birdify as something the CLI changes or reimplements was rejected.

### Escape backticks in the CLI usage template
Status: discussed
Touches: `apps/cli/src/**`

Typecheck failed on an unescaped backtick inside a usage template literal. The template was escaped so the CLI compiles; command behavior was unchanged.

Reviewer attention: Confirm the usage string still renders the intended backticks after the escape.

### Ignore generated Vitest output directories
Status: discussed — left out of the init-default commit
Touches: `apps/cli/.vitest/json/output.json`, `apps/cli/.vitest/**`

Generated Vitest reporter output under apps/cli/.vitest was unstaged and omitted from 0500236 so that commit contained only the init default change.

### Default the init seed to the agent backend and auto model
Status: directed
Touches: `apps/cli/src/commands/init.ts`, `apps/cli/src/util/config.ts`, `docs/config.md`, `apps/cli/test/selfonly.test.ts`, `apps/cli/test/backends.test.ts`

Init now writes backend agent and models.agent set to auto, replacing the previous claude seed. Claude and codex stay valid config overrides. The config guide and CLI tests were updated to match that seed; 19 related tests passed. The change landed as 0500236, feat(cli): default the distiller to agent.

Considered/rejected: Keeping the init seed on claude was the prior default. Removing claude and codex from the config surface was not done; both remain selectable overrides.
Risk: New inits start on agent with model auto, so anything that assumed a fresh seed named claude will not get that default.
Reviewer attention: Confirm a fresh init writes backend agent and models.agent auto, and that claude and codex still parse as config overrides.

### Rebuild the CLI bundle before publish so a stale dist cannot ship
Status: discussed — identified as the proper fix; not applied in this part
Touches: `apps/cli/package.json`, `.github/workflows/release.yml`, `apps/cli/dist/cli.js`

Publish must build dist immediately before packing. The release workflow already runs a build before publish on a tag checkout, but the registry 0.1.2 artifact still contains a dist whose inlined version is 0.1.1, which matches a pack of a leftover local bundle rather than a build from package.json 0.1.2. Because dist is gitignored and listed in the published files, npm publish ships whatever bundle is already on disk. A prepublishOnly build makes that bundle match the version being published. A runtime package.json read does not by itself repair an already published tarball.

Considered/rejected: Trusting only the tag workflow was not enough: the published 0.1.2 dist does not match a build from that tag's package.json version.
Risk: Already published 0.1.2 keeps reporting 0.1.1 until a later publish replaces the tarball.
Reviewer attention: Confirm the next packed tarball was built after the version bump and that its dist no longer contains the literal 0.1.1.

### Put the first distiller chunk error into the failure reason
Status: discussed
Touches: `apps/cli/src/distiller/index.ts`

Every distiller chunk was reported as failed with no cause because the per-chunk catch discarded the error. A non-zero CLI exit, unparseable output, and a failed spawn were therefore indistinguishable. The distiller now keeps the first error and appends it to the session failure reason.

Considered/rejected: Treating a quota or rate-limit response as a non-retryable abort of the remaining sessions was weighed. The change that landed only propagates the backend message; each session still fails on its own with that text.
Reviewer attention: Confirm a failed distill names the backend error instead of only 'all N chunk(s) failed'.

### Use stdout when a distiller CLI failure has empty stderr
Status: discussed
Touches: `apps/cli/src/distiller/backends.ts`

The backend previously put only stderr into a non-zero exit error. Refusal and limit text was observed on stdout, so the failure reason could still be empty after the catch was fixed. The message now uses stderr when it is non-empty and otherwise stdout.

Risk: Any non-empty stderr hides stdout, so a warning on stderr can still mask the CLI's actual message.
Reviewer attention: Confirm a non-zero distiller CLI that prints only on stdout shows that text in the session failure reason.

### Load the distiller child environment through a split process property name
Status: discussed
Touches: `apps/cli/src/distiller/backends.ts`

Minifying the CLI replaced every static process.env reference with an empty object, so the spawned CLI received only REASONGRAPH_DISTILLING=1 and no PATH and failed with spawn ENOENT. Object spread, Object.assign, Object.fromEntries, and globalThis.process.env all compiled to empty objects. Reading the environment through a split property name on globalThis survives minification, so the child inherits PATH and the CLI can be spawned.

Considered/rejected: Those four direct process.env forms were built and all collapsed to an empty object, so they cannot be used in this bundle.
Risk: A later minifier that folds string concatenation can empty the child environment again. Vitest does not bundle, so ordinary unit tests would still pass.
Reviewer attention: Confirm the built dist/cli.js still copies a real environment object into the distiller spawn and is not an empty object literal.

### Assert the built CLI still forwards a real environment to the distiller child
Status: discussed
Touches: `apps/cli/test/backendEnv.test.ts`, `apps/cli/package.json`

A regression test reads apps/cli/dist/cli.js and fails if the bundler emptied the distiller child environment. An existsSync early return made a missing dist a silent pass, so that return was removed. The CLI package pretest script runs the Vite build so pnpm test has an artifact. The CI workflow already builds before tests. Reverting the environment indirection and rebuilding made the test fail; restoring it made the test pass. After the two new assertions the suite was 101 passing.

Risk: pnpm test now depends on a successful Vite build before Vitest runs.
Reviewer attention: Confirm the test fails when dist/cli.js is absent and when the child env is compiled as an empty object, and that pretest is vite build.

### Defer loading node:sqlite until an OpenCode database is opened
Status: directed
Touches: `apps/cli/src/adapters/opencode.ts`, `apps/cli/src/adapters/index.ts`

A top-level import of node:sqlite made Node emit ExperimentalWarning: SQLite on every command, including --version, because the adapter registry constructs OpenCodeAdapter at startup. The value import was replaced with a type-only import, which the build erases, and DatabaseSync is loaded on first open with createRequire because the package is ESM and the adapter API is synchronous. The warning remains only when a command actually opens an OpenCode database. The built CLI loads node:sqlite from inside that function rather than as a top-level import.

Considered/rejected: NODE_OPTIONS=--no-warnings was rejected because it would hide every warning, including ones that should stay visible.
Reviewer attention: Confirm --version and status emit no SQLite experimental warning, and that opening an OpenCode database still constructs DatabaseSync read-only.

### Keep OpenCode transcript reads on node:sqlite
Status: discussed
Touches: `apps/cli/src/adapters/opencode.ts`, `apps/cli/package.json`

OpenCode's SQLite database is read with node:sqlite, and the dependency is loaded only when an OpenCode database is opened. This preserves the native read path while avoiding SQLite startup cost for other adapters.

### Specify init progress logging as RFC 0009 and leave it Draft
Status: directed — finish approval closed the draft
Touches: `.spec/rfc/completed/0009-init-command-progress.md`, `.spec/rfc/*`

RFC 0009 was marked Implemented and moved under the completed RFC archive after the approved finish pass. Implementation, full CLI verification, and RFC sync-check completed before the archive step.

Reviewer attention: Confirm the completed RFC text matches the shipped init progress behavior and that draft/active copies are gone.

### Leave the CLI init implementation unchanged until the progress plan is approved
Status: directed — superseded by finish approval
Touches: `apps/cli/**`

With RFC 0009 finished, the previously deferred init progress work was implemented in the CLI rather than left unchanged. Existing staged why-pack work outside this change was left alone.

Considered/rejected: Keeping the CLI init path untouched was appropriate only while the progress plan stayed unapproved.

### Report real init stages through the shared log helpers
Status: directed
Touches: `apps/cli/**`

Init now emits real stage progress through the shared log helpers, including a scan-progress cue before backfill. The agent used failing Vitest expectations around missing progress output to drive the wiring.

Risk: Progress noise or misleading stage labels if helpers are reused inconsistently.
Reviewer attention: Confirm stage names and ordering match actual init work, including the pre-backfill scan cue.

### Color init logs only on capable terminals and honor NO_COLOR
Status: directed
Touches: `apps/cli/**`

Interactive capable terminals get colored init logs; non-TTY output and NO_COLOR force plain text. Early Vitest failures around missing NO_COLOR detection were used to correct the capability check.

Reviewer attention: Confirm color is suppressed for non-TTY and when NO_COLOR is set.

### Preserve existing init and backfill behavior
Status: directed
Touches: `apps/cli/**`

Progress logging was added without changing the existing init seed/backfill semantics. The finish pass treated behavior preservation as a hard constraint alongside the new stage output.

Reviewer attention: Smoke-check that init still seeds and backfills as before aside from added progress lines.

### Cover init progress logging with Vitest
Status: directed
Touches: `apps/cli/**`

Progress output and NO_COLOR/TTY behavior were covered with Vitest inside the CLI package using a fail-first approach. Target tests and the full CLI suite passed at 108/108; typecheck, ESLint, and Prettier recheck also passed after formatting the flagged files.

Reviewer attention: Confirm the new tests assert stage output and colorless modes, not only suite green.

### Format only Prettier-flagged files before RFC archive
Status: discussed
Touches: `apps/cli/**`, `.spec/rfc/completed/0009-init-command-progress.md`

Prettier reported four changed files out of format after the implementation pass. Only those four were reformatted, then verification was re-run before archiving the RFC.

Considered/rejected: Formatting the whole repo was avoided to limit unrelated churn.

### Fix trailing blank line in TASK_TRACKING after RFC archive
Status: discussed
Touches: `**/TASK_TRACKING*`

Archiving left a trailing blank line in TASK_TRACKING that git diff --check flagged. That whitespace-only issue was removed and the three RFC-related files were brought into a consistent staged state.

Risk: Whitespace-only churn on tracking files can fail check-based gates.

### Stage RFC archive files without staging CLI implementation or why-pack changes
Status: agent-initiated — not requested in plan or prompts
Touches: `.spec/rfc/completed/0009-init-command-progress.md`, `apps/cli/**`, `.reasongraph/why/**`

After finish verification, RFC archive updates were staged while the CLI implementation stayed unstaged and the already-staged why-pack changes were left untouched. No commit was created.

Risk: Split staging can leave a finished RFC without the matching CLI code on the same commit unless a later commit reconciles them.
Reviewer attention: Confirm intentional split between staged RFC files and unstaged CLI implementation before any commit.

### Build a fancy interactive TUI for sync and status progress
Status: directed
Touches: `apps/cli/**`

sync and status should use a full interactive terminal UI showing stages, current session/chunk progress, and a closing summary, not merely colored log lines. Fancy presentation is reserved for capable TTYs.

Considered/rejected: Shipping only colorful progress logs without a real TUI was rejected as insufficient for the requested UX. Avoiding a TUI dependency entirely was the earlier undershoot and is no longer the target.
Risk: A fuller TUI can add dependency and complexity versus plain logging.
Reviewer attention: Confirm the TUI covers stage, session/chunk progress, and final summary without regressing non-TTY paths.

### Keep plain-text sync output under Git hooks and CI
Status: discussed
Touches: `apps/cli/**`

Interactive fancy output is gated to capable terminals. Git hook and CI runs should keep concise plain-text status so automated environments stay readable and non-interactive.

Reviewer attention: Confirm TTY/CI/hook detection chooses the plain-text path reliably.

### Merge repeated why-pack path lines during sync reporting
Status: discussed
Touches: `apps/cli/**`, `.reasongraph/why/**`

Sync currently reprints the same why-pack path per session and inserts mid-run chunk-failure lines without a clear overall summary. Output should collapse results by why-pack path to reduce spam and make progress/summary readable.

Risk: Over-aggressive merging could hide per-session detail reviewers still need.

### Remove interactive Enter confirmation from the pre-push distill path
Status: directed
Touches: `**/pre-push*`, `apps/cli/**`

The pre-push hook can run distill with a 60-second budget and wait for Enter after committing why-pack updates. That wait can make push look stuck, and Ctrl-C during the prompt aborts the push. The hook’s `|| true` only swallows ordinary command failures, not that interrupt path. Interactive Enter wait should be removed so push is not blocked; heavy distill work should stay on reasongraph sync.

Considered/rejected: Treating `|| true` as proof that push cannot fail was incorrect: ordinary command failure is ignored, but Ctrl-C during the Enter wait still stops push.
Risk: Removing the pause changes operator workflow for reviewing why-pack commits before push completes.
Reviewer attention: Confirm pre-push no longer waits for Enter and that Ctrl-C is not the only practical way out of a long distill.

### Specify sync TUI, SQLite strategy, and pre-push wait changes in a new RFC before coding
Status: discussed
Touches: `docs/**`, `apps/cli/**`, `**/pre-push*`

Per the repository RFC process, this pass stayed analysis-only. A single RFC should cover the SQLite compatibility stance, the sync/status TUI design, and removal of push-time interactive wait before implementation proceeds.

Reviewer attention: Confirm the RFC is drafted and approved before CLI or hook code lands.

### Install the plugin with npx @borg0ai/plugins
Status: directed
Touches: `apps/cli/src/commands/install.ts`, `apps/plugins/*`

The proposed `install()` flow invokes `npx @borg0ai/plugins add borg0ai/dx-reasongraph --scope project --yes`. This uses the package-scoped plugin CLI and avoids a local workspace build path or an unscoped `npx plugins` invocation.

### Move the plugins package from packages/plugins to apps/plugins
Status: discussed
Touches: `apps/cli/src/commands/install.ts`, `apps/plugins/*`, `packages/plugins/*`

The proposed design treats `@borg0ai/plugins` as an executable CLI and places it under `apps/`. The CLI should invoke the scoped package command, rather than resolve a local `dist` file through a workspace-relative path.

Considered/rejected: Resolving `packages/plugins/dist/index.js` from `__dirname` was rejected because it relies on source/build directory depth and cannot work from the published CLI package.

### Leave deletion of the in-repo plugins package unresolved
Status: discussed
Touches: `apps/plugins/**`, `.spec/rfc/0010-scoped-plugins-cli-install.md`, `apps/cli/test/plugin.test.ts`

No choice was applied between removing the in-repo plugins package and keeping it. Removal would delete apps/plugins and clean the lockfile, root package.json scripts, RFC 0010, and plugin tests, leaving the workspace as apps/* with only the CLI. The other option is a thin in-repo wrapper that neither copies plugin files nor spawns a local plugins binary.

Considered/rejected: Deleting apps/plugins outright, or retaining it only as a thin wrapper. Neither was applied.
Reviewer attention: Confirm the package is either fully removed with its RFC and tests, or explicitly kept as a thin wrapper with no local npx spawn.

### Delete the in-repo plugins package and keep only apps in the workspace
Status: discussed
Touches: `apps/plugins`, `packages`, `pnpm-workspace.yaml`, `package.json`, `pnpm-lock.yaml`

The self-contained plugins package is removed from apps/plugins and packages, and pnpm-workspace.yaml lists only apps/*. Root package metadata and pnpm-lock.yaml no longer reference that package. pnpm reported one fewer workspace package after the removal.

Considered/rejected: Keeping an in-repo plugins build and resolving its dist from the installer was dropped so install does not depend on a local artifact.
Risk: Registry availability of the external plugins CLI is unverified because that command is not executed.
Reviewer attention: Confirm the workspace contains only apps/* and that no plugins package entry remains in the lockfile.

### Specify the scoped plugins CLI install as RFC 0010 and mark it implemented
Status: discussed
Touches: `.spec/rfc/0010-scoped-plugins-cli-install.md`

The RFC records the proposed install command and rejects locating a sibling package’s `dist` file by resolving paths from the CLI source. That path strategy depends on repository layout and fails for the published package. The RFC remained Draft and implementation was not changed in this transcript.

Reviewer attention: Confirm RFC 0010 status and approval before treating its proposed implementation as accepted.

### Do not invoke the plugins CLI during verification
Status: directed — live invocation excluded from the check
Touches: `**/plugin.test.ts`, `**/install.ts`

Verification of the install change does not spawn the plugins CLI. Coverage stays on installer source assertions, and the published package is not fetched.

Risk: Whether the scoped CLI can be resolved from the registry remains unknown.

### Require a patch changeset for the npx-only plugin install
Status: discussed — gap identified; changeset not added
Touches: `.changeset/*`

The existing changesets bright-seas-reason, modern-cats-reply, and quiet-lizards-update do not describe switching install to only the scoped plugins CLI. A patch changeset for that behavior is still required before release, and none was added. Lint, build, and format checks passed with the same 109 tests.

Risk: A release cut from the current changesets would omit the install behavior from the published notes.
Reviewer attention: Confirm a new patch changeset names the npx-only install before any release.

### Exclude the hook-generated why-pack from the release commit
Status: discussed — called out; no commit created
Touches: `.reasongraph/why/main.md`

.reasongraph/why/main.md is hook-generated and was identified as content that should stay out of the commit for this install change. No commit was created.

Reviewer attention: Confirm a later commit does not stage .reasongraph/why/main.md with the install and RFC files.

### Format the existing Nix package to pass CI
Status: discussed
Touches: `nix/gopdf.nix`

The Nix formatting check required reformatting an existing `inherit` expression. The change applied the formatter’s expected layout so CI could proceed.

### Fall back to another installed distiller CLI after failure
Status: discussed
Touches: `apps/cli/src/distiller/backends.ts`, `apps/cli/src/distiller/index.ts`, `apps/cli/test/backends.test.ts`

A configured distiller can fail because its CLI is unavailable or cannot complete a request. The CLI now tries other installed backends after failure, allowing a sync to continue when another backend is usable. This sends transcript content to the fallback backend.

### Show colored session progress in interactive terminals
Status: directed
Touches: `apps/cli/src/commands/sync.ts`, `apps/cli/src/commands/distill.ts`, `apps/cli/src/util/log.ts`, `apps/cli/test/log.test.ts`

Per-session progress, chunk counts, elapsed time, and a final summary make long distillation runs observable. Color and interactive progress are limited to TTY output so hooks and pipelines retain plain-text logs.

### Set the local distiller to Codex with medium reasoning effort
Status: directed
Touches: `apps/cli/src/distiller/backends.ts`, `apps/cli/test/backends.test.ts`, `.reasongraph/state/config.json`

The local configuration selects Codex with model `gpt-6-luna` and explicitly passes medium reasoning effort. Keeping this choice in repository-local state avoids changing the shared backend configuration.

### Consolidate the why-pack design record into AGENTS.md
Status: directed
Touches: `AGENTS.md`, `.ai/why/main.md`, `.ai/why/.gitkeep`

The design record was moved into AGENTS.md so repository guidance and its rationale live together. The former .ai files were removed.

### Run CI and release from the scoped CLI package
Status: discussed
Touches: `.github/workflows/ci.yml`, `.github/workflows/release.yml`

CI installs dependencies with pnpm and builds and tests @borg0ai/reasongraph. Tagged releases publish from apps/cli with npm provenance, matching the package boundary defined by the redesign.

### Read Codex and cursor-agent transcripts as JSONL
Status: discussed
Touches: `apps/cli/src/adapters/codex.ts`, `apps/cli/src/adapters/cursor-agent.ts`, `apps/cli/src/adapters/jsonl.ts`, `apps/cli/src/adapters/index.ts`

Codex sessions are read from ~/.codex/sessions/**/*.jsonl, and cursor-agent sessions from project agent-transcripts directories. JSONL byte offsets provide incremental reads without depending on transcript file size as a general freshness signal.

### Read OpenCode sessions from session_v2 with message cursors
Status: discussed
Touches: `apps/cli/src/adapters/opencode.ts`, `apps/cli/src/adapters/types.ts`, `apps/cli/src/state/state.ts`, `apps/cli/test/fixtures/opencode-session.sql`

The adapter reads OpenCode's session_v2 and session_message tables, associates sessions with the repository by directory, and uses the last distilled message ID as its cursor. This handles database updates that do not change the database file size.

### Route freshness checks through transcript adapters
Status: discussed
Touches: `apps/cli/src/core/sweep.ts`, `apps/cli/src/core/distillSession.ts`, `apps/cli/src/commands/status.ts`, `apps/cli/src/commands/hook.ts`, `apps/cli/src/adapters/types.ts`

Adapters determine whether their sessions have new activity because transcript formats expose different cursors. Sweep, status, and hook paths use adapter freshness checks instead of comparing file sizes; truncated distillation does not advance the cursor.

### Ignore OpenCode databases that cannot be read as supported transcripts
Status: discussed
Touches: `apps/cli/src/adapters/opencode.ts`

An unreadable database or unsupported table layout returns no sessions instead of throwing through init or sync. This keeps optional local transcript discovery from breaking unrelated CLI operations.

### Remove Playwright snapshots from Git tracking
Status: directed
Touches: `.gitignore`, `.playwright-mcp/**`

Generated Playwright artifacts are ignored and removed from the Git index while remaining on disk. This keeps local browser snapshots out of repository history.
