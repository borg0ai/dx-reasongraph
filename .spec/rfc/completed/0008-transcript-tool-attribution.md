# RFC 0008: Attribute each transcript to the adapter that owns it

**Status:** Implemented

## Summary

Stop and SessionEnd always store `tool: "claude-code"`. A Codex or cursor-agent transcript recorded that way is parsed by `ClaudeCodeAdapter`, which yields no events. `distillEvents` treats an empty event list as success, writes the empty why-pack, advances the cursor to EOF, and marks the session distilled. Later distills skip it. This RFC picks the adapter from the transcript path, rewrites a mismatched record so it can be read again, and refuses to seal a non-empty transcript that produced no events.

## Problem

RFC 0007 added `CodexAdapter`, `OpenCodeAdapter`, and `CursorAgentAdapter`, and `discoverAndSync` stores `adapter.tool` for sessions it finds. The hook path does not. `hookStop` and `hookSessionEnd` in `apps/cli/src/commands/hook.ts` pass the literal `"claude-code"` into `upsertSession`. `upsertSession` copies `tool` only when the session is new, and `discoverAndSync` does not change `tool` on a session that already exists. The first writer wins, and the hook is often first.

`ClaudeCodeAdapter.normalizeEvents` keeps only Claude lines (`type` `user` or `assistant`, `message.content`). A Codex rollout is `session_meta`, `event_msg`, and `response_item` under `payload`. None of those match, so the event list is empty. `files_touched` and `branches_seen` stay empty for the same reason: `extractMeta` looks for Claude `gitBranch` and `tool_use` paths.

`distillEvents` then returns `{ ok: true, pack: emptyPack() }`. `distillSession` renders `_No decisions recorded yet._`, sets `last_distilled_offset` to the file size, and sets `status: "distilled"`. `sessionsNeedingDistill` will not select that session again. The empty pack is not a distiller judgment that the session had no decisions. The distiller never saw the transcript.

Observed on this repo: session `01a0e0f7-6d4a-7243-adf3-a587b8daaf48` points at a Codex rollout under `~/.codex/sessions/`, is stored as `claude-code`, has `last_distilled_offset` at end of file, `distilled_to` includes `main`, and `.reasongraph/why/main.md` has no decisions. The same hook also stamped `claude-code` on a cursor-agent transcript under `agent-transcripts/`.

## Goals

* Choose `tool` from the transcript path, in both hooks and in discovery of an existing record.
* When the stored tool does not own that path, switch to the owning adapter and reset the distill cursor so the next distill reads from the start.
* When a non-empty read normalizes to zero events, leave the session dirty and do not advance the cursor.
* Keep a real Claude Code transcript on `claude-code`.

## Non-goals

* New native Stop, SessionEnd, or PreToolUse manifests for Codex, OpenCode, or cursor-agent. RFC 0007 left those to a later RFC. This RFC only stops the existing hook from labeling a path it was already given.
* Why-pack format, privacy rules, or the distiller prompt.
* Deleting an already-written empty placeholder. The next distill that produces decisions rewrites it through `renderPack`.
* Guessing a tool for a path no adapter owns.

## Design

Add `ownsTranscript(transcriptPath: string): boolean` to `Adapter` in `apps/cli/src/adapters/types.ts`. Each adapter implements a disjoint check:

* `CodexAdapter`: the path is under its sessions root (`~/.codex/sessions` by default).
* `OpenCodeAdapter`: the file basename is `opencode.db`.
* `CursorAgentAdapter`: the path contains `agent-transcripts` and ends in `.jsonl`.
* `ClaudeCodeAdapter`: the path is under `~/.claude/projects` and ends in `.jsonl`.

Add `toolForTranscript(transcriptPath: string): string | undefined` in `apps/cli/src/adapters/index.ts`. It returns the `tool` of the single adapter whose `ownsTranscript` is true, or `undefined` when none match.

`hookStop` and `hookSessionEnd` call `toolForTranscript(input.transcript_path)` instead of the literal `"claude-code"`. If the result is `undefined`, the hook returns 0 without creating a session. If the result is set, that string is the `tool` passed to `upsertSession`.

`upsertSession` applies `patch.tool` on an existing record. When the tool string changes, it sets `last_distilled_offset` to 0, clears `last_distilled_cursor`, and sets `status` to `"dirty"`. A matching tool does not reset the cursor.

`discoverAndSync` runs the same correction for a session that already exists: if `toolForTranscript(transcript_path)` is set and differs from `rec.tool`, update `tool` and reset the cursor the same way, then `writeSession`. This runs before `sessionsNeedingDistill`, so a sealed Codex file becomes dirty again on the next `reasongraph distill` without waiting for another hook.

`distillSession` still resolves the adapter from `record.tool` after that correction. After `readNew`, if `raw.trim()` is non-empty and `normalizeEvents(raw)` is empty, return `ok: false` with reason `no events from non-empty transcript`, leave `status` dirty, and do not change `last_distilled_offset` or write the pack. The existing empty-raw path (nothing new, mark distilled) stays.

## Acceptance

* `toolForTranscript` returns `codex` for a path under the Codex sessions root, `cursor-agent` for an `agent-transcripts` JSONL, `opencode` for `opencode.db`, `claude-code` for a `~/.claude/projects` JSONL, and `undefined` for anything else.
* A stored session with `tool: "claude-code"` and a Codex `transcript_path` becomes `tool: "codex"`, `last_distilled_offset: 0`, and `status: "dirty"` when `discoverAndSync` runs.
* Distilling the existing Codex fixture through that corrected record reaches the mock backend. The Claude adapter is not the one that normalizes it.
* A non-empty transcript that normalizes to zero events does not change `last_distilled_offset` and stays `dirty`.
* `pnpm --filter @borg0ai/reasongraph test` passes.
