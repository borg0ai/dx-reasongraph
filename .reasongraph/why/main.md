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
Status: directed
Touches: `.spec/rfc/completed/0008-transcript-tool-attribution.md`, `.spec/ROADMAP.md`, `.spec/TASK_TRACKING.md`

The fix is recorded as RFC 0008, "Attribute each transcript to the adapter that owns it," covering `ownsTranscript`, path-based tool selection, hook storage, rewind of a mismatched tool, and refusing to seal a non-empty zero-event read. The document validated clean, then was advanced to Implemented at `.spec/rfc/completed/0008-transcript-tool-attribution.md`, with roadmap and task tracking pointed at it.

Reviewer attention: Confirm the completed RFC still matches the hook, sweep, and distillSession behavior, including the rewind to offset 0.

### Lock path ownership and rewind behavior in CLI tests
Status: directed
Touches: `apps/cli/test/transcriptTool.test.ts`, `apps/cli/test/state.test.ts`

Path ownership and the session rewind are covered by new tests in `transcriptTool.test.ts` and updates in `state.test.ts`. The package test run, including `agentAdapters.test.ts` and `distillSession.test.ts`, reported 99 tests passed.

Reviewer attention: Confirm the new tests cover an unknown path, each owned layout, a tool mismatch that rewinds offset to 0, and a non-empty zero-event read that stays dirty.

### Skip a failed distiller chunk without logging the backend error
Status: discussed — pre-existing catch; surfaced while tracing chunk failures, left as-is
Touches: `apps/cli/src/distiller/index.ts`, `apps/cli/src/distiller/backends.ts`, `.reasongraph/config.json`

Config sets `distiller.backend` to `claude` and the model to `haiku`, and each chunk spawns `claude -p`. `distillEvents` catches a chunk error, drops the message, and only increments `chunkFailures`, so the CLI reports that every chunk failed. All eight sessions failed that way (chunk counts 1, 9, 26, 9, 3, 1, 1, and 1). They stay `dirty` and the offset does not advance. A direct `claude -p --model haiku` exited 1 because a session limit was in effect, which is what every spawn hit. The in-code comment keeps the catch so one failed chunk does not drop decisions from the rest of the session.

Risk: The only operator-visible signal is the chunk-failure count, so a backend refusal looks like a generic distill failure.
Reviewer attention: Confirm whether the empty catch should keep hiding the backend exit text; sessions remain retryable because the offset does not move.
