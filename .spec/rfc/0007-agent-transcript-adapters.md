# RFC 0007: Distill Codex, OpenCode, and cursor-agent sessions

**Status:** Draft

## Summary

Finish write-side support for Codex, OpenCode, and cursor-agent. Each gets an adapter that discovers sessions for the current repo and normalizes them into the events the distiller already consumes. Claude Code stays the byte-offset JSONL adapter. SQLite-backed sessions stop using file size as the freshness signal.

## Problem

`ADAPTERS` contains only `ClaudeCodeAdapter`. `CodexAdapter` returns empty arrays and is listed in `STUBBED_ADAPTERS`, so sweeps never see Codex sessions under `~/.codex/sessions/`. OpenCode sessions live in `~/.local/share/opencode/opencode.db` (`session`, `message`, `part`, `project`, `project_directory`) and have no adapter. cursor-agent writes JSONL under `~/.cursor/projects/<project>/agent-transcripts/` and a per-chat SQLite store under `~/.cursor/chats/`; neither is read.

`sweep.ts`, `status.ts`, and `hook.ts` treat `fileSize(transcript_path) > last_distilled_offset` as "new activity". That is true for an append-only JSONL file. It is false for OpenCode's single database: WAL buffering can leave the main file size unchanged while new rows exist, and one file holds every session.

The read side is already agent-neutral. `reasongraph context` and the why-pack do not care which tool wrote the session. This RFC is only the missing write side.

## Goals

* Move a real Codex adapter into `ADAPTERS` and delete the stub behavior.
* Add an OpenCode adapter and a cursor-agent adapter to `ADAPTERS`.
* Discover only sessions whose recorded cwd is the repo being distilled.
* Feed `normalizeEvents` the same event kinds Claude already produces: `user_text`, `assistant_text`, `thinking`, `tool_call_summary`.
* Decide freshness inside the adapter. JSONL adapters keep a byte offset. The OpenCode adapter uses a per-session row cursor stored on the session record.
* Cover each adapter with a committed fixture and a distill test. Claude's existing tests stay green.

## Non-goals

* Native `Stop` / `SessionEnd` / `PreToolUse` hooks for these three tools. `reasongraph/hooks/hooks.json` stays the Claude Code hook manifest. Automatic settle for Codex, OpenCode, and cursor-agent is `reasongraph distill` and `reasongraph sync` until a later RFC maps each tool's own hook names.
* Decoding cursor-agent `store.db` blobs. The JSONL export is the transcript this RFC reads.
* IDE sidepane chats that exist only in Cursor's `state.vscdb`.
* Changing why-pack format, the skill install flow in RFC 0005, or the PromptScript reviewer in RFC 0006.

## Design

### Freshness

Add `hasNewActivity(record): boolean` and `readNew(record): ReadResult` to `Adapter`. JSONL adapters implement them with the current byte offset. Call sites in `apps/cli/src/core/sweep.ts`, `apps/cli/src/commands/status.ts`, and `apps/cli/src/commands/hook.ts` stop calling `fileSize` themselves.

OpenCode stores its cursor in a new string field `last_distilled_cursor` on the session record. Absence means "never distilled". The field is the last `message` id included. `last_distilled_offset` remains the JSONL byte offset so existing Claude records do not migrate.

### Codex

Implement the contract already commented in `apps/cli/src/adapters/codex.ts`. Walk `~/.codex/sessions/**/*.jsonl`. Match the repo on the cwd recorded in the rollout. Read incrementally from the byte offset, tolerate a truncated final line the way `claude-code.ts` does, and drop full file bodies and command output. Register the class in `ADAPTERS` and remove it from `STUBBED_ADAPTERS`.

### cursor-agent

Read `~/.cursor/projects/<project>/agent-transcripts/<id>/<id>.jsonl`. The project directory slug is the absolute repo path with non-alphanumeric characters replaced, matching Cursor's on-disk layout. Incremental read is the same byte-offset path as Codex. Tool-call lines become `tool_call_summary`. Missing tool results in that JSONL are omitted, not fetched from `store.db`.

### OpenCode

Open `~/.local/share/opencode/opencode.db` read-only. Select sessions whose project directory is the repo. Read `message` and `part` rows for that session with id greater than `last_distilled_cursor`. Map parts into the normalized event kinds. Do not use the database file size as a cursor.

Pin the SQL to a fixture copied from a real `opencode.db`, not to an assumed schema. If `session` and `session_v2` disagree, the fixture test names which table the adapter reads.

## Acceptance

* A Codex fixture under `apps/cli/test/fixtures/` distills through `CodexAdapter` and lands in `.reasongraph/why/`.
* A cursor-agent JSONL fixture does the same through its adapter.
* An OpenCode sqlite fixture does the same, including a second distill that reads only rows after `last_distilled_cursor`.
* Sweep and status report the OpenCode session dirty when new rows exist and the database file size is unchanged.
* `pnpm --filter @borg0ai/reasongraph test` passes.
* `ADAPTERS` lists Claude Code, Codex, OpenCode, and cursor-agent. `STUBBED_ADAPTERS` is empty.
