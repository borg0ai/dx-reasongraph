# Why: main

<!-- reasongraph:v1 generated 2026-09-27 — review before sharing; edit freely, edits are preserved -->

## Intent
Attribute each transcript to the adapter that owns its path, and stop marking a distill finished when a non-empty read yields no events.

## Decisions

### Bake the CLI version from package.json at build time
Status: discussed — rationale is from the uncommitted diff; the why-pack had no entry
Touches: `apps/cli/src/cli.ts`, `apps/cli/vite.config.ts`, `apps/cli/package.json`, `package.json`, `reasongraph/.plugin/plugin.json`, `reasongraph/skills/reasongraph/skill-release.json`

`--version` and the usage banner both print `VERSION`. That value was still the hardcoded string `1.1.0` after the published `@borg0ai/reasongraph` package moved from `0.1.0` to `0.1.1` in commit `d6ff83a`, which bumped root `package.json`, `apps/cli/package.json`, `reasongraph/.plugin/plugin.json`, and `reasongraph/skills/reasongraph/skill-release.json` and left the banner string alone. The `bin` entry is the Vite bundle `dist/cli.js`, so the version has to be compiled in: `vite.config.ts` reads `apps/cli/package.json` and `define`s `__REASONGRAPH_VERSION__` with `JSON.stringify` (so `0.1.1` becomes the literal `"0.1.1"`), and `cli.ts` binds `VERSION` to that `declare const`. Changing `package.json` does not update an already built `dist/cli.js` until the next Vite build.

Considered/rejected: A runtime read of package.json was not used because the published entry point is the Vite bundle, which needs the version replaced at build time.
Risk: The banner stays stale until the CLI is rebuilt after a version bump.
Reviewer attention: Confirm `define` injects a string literal and that both `--version` and the usage banner read the same `VERSION`.

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
