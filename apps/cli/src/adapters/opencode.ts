import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";
// Type-only: erased at compile time, so it costs no runtime import. The
// *value* is loaded lazily in openDb() — see the note there.
import type { DatabaseSync } from "node:sqlite";
import {
  Adapter,
  DiscoveredSession,
  NormalizedEvent,
  ReadResult,
  SessionCursor,
  TranscriptMeta,
} from "./types.js";
import { samePath } from "./jsonl.js";
import { TOOL_OPENCODE } from "./names.js";

const DB_FILENAME = "opencode.db";

/** Unread row count stands in for bytes so the Stop-hook threshold still trips. */
const ROW_ACTIVITY_BYTES = 1_000_000;
const ARG_LIMIT = 180;

const TYPE_USER = "user";
const TYPE_ASSISTANT = "assistant";
const CONTENT_REASONING = "reasoning";
const CONTENT_TEXT = "text";
const CONTENT_TOOL = "tool";

/**
 * Current OpenCode db (~/.local/share/opencode/opencode.db) stores sessions in
 * `session_v2` and transcript rows in `session_message`. There is no `part` table.
 * A legacy `session` table, when present, is not read.
 */
const SESSION_SQL = `SELECT id, directory, path FROM session_v2`;

const MESSAGES_SQL = `
  SELECT id, time_created, type, data FROM session_message
  WHERE session_id = ?
  ORDER BY time_created, seq, id
`;

interface MessageRow {
  id: string;
  time_created: number;
  type: string;
  data: string;
}

interface RawLine {
  type?: string;
  timestamp?: string;
  data?: Record<string, unknown>;
}

/**
 * Lazily-loaded `node:sqlite` constructor, cached after the first success.
 *
 * `node:sqlite` is still experimental, so merely importing it makes Node print
 * `ExperimentalWarning: SQLite is an experimental feature` to stderr. A static
 * top-level import fired that on EVERY reasongraph command — including ones
 * that never touch an OpenCode db (`--version`, `context`, git-only paths) —
 * which trained people to ignore all stderr.
 *
 * Requiring it on first use confines the warning to runs that actually read an
 * OpenCode database, where it is accurate and worth seeing. `createRequire` is
 * used because this module is ESM and the adapter API is synchronous.
 */
let sqliteCtor: typeof import("node:sqlite").DatabaseSync | undefined;

function openDb(file: string): DatabaseSync | null {
  try {
    const Ctor = sqliteCtor ?? (sqliteCtor = createRequire(import.meta.url)("node:sqlite").DatabaseSync);
    return new Ctor(file, { readOnly: true });
  } catch {
    return null;
  }
}

function rowsAfter(messages: MessageRow[], cursor: string | undefined): MessageRow[] {
  if (!cursor) return messages;
  const index = messages.findIndex((row) => row.id === cursor);
  if (index === -1) return messages;
  return messages.slice(index + 1);
}

function toolSummary(name: string, input: Record<string, unknown> | undefined): { text: string; file?: string } {
  const file = input?.path ?? input?.file_path;
  const command = typeof input?.command === "string" ? input.command.split("\n")[0] : "";
  if (typeof file === "string" && command) return { text: `${name} ${file}: ${command.slice(0, ARG_LIMIT)}`, file };
  if (typeof file === "string") return { text: `${name} ${file}`, file };
  if (command) return { text: `${name}: ${command.slice(0, ARG_LIMIT)}` };
  return { text: name };
}

function eventsFromLine(line: RawLine): NormalizedEvent[] {
  const data = line.data ?? {};
  const timestamp = line.timestamp;
  if (line.type === TYPE_USER) {
    const text = typeof data.text === "string" ? data.text.trim() : "";
    return text ? [{ kind: "user_text", text, timestamp }] : [];
  }
  if (line.type !== TYPE_ASSISTANT || !Array.isArray(data.content)) return [];
  const events: NormalizedEvent[] = [];
  for (const part of data.content) {
    if (!part || typeof part !== "object") continue;
    const block = part as Record<string, unknown>;
    const text = typeof block.text === "string" ? block.text.trim() : "";
    if (block.type === CONTENT_REASONING && text) {
      events.push({ kind: "thinking", text, timestamp });
    } else if (block.type === CONTENT_TEXT && text) {
      events.push({ kind: "assistant_text", text, timestamp });
    } else if (block.type === CONTENT_TOOL) {
      const tool = typeof block.name === "string" ? block.name : "tool";
      const state = block.state && typeof block.state === "object" ? (block.state as Record<string, unknown>) : {};
      const input = state.input && typeof state.input === "object" ? (state.input as Record<string, unknown>) : undefined;
      const summary = toolSummary(tool, input);
      events.push({ kind: "tool_call_summary", tool, text: summary.text, timestamp });
    }
  }
  return events;
}

function filesFromLine(line: RawLine): string[] {
  const data = line.data ?? {};
  const files: string[] = [];
  const snapshot = data.snapshot && typeof data.snapshot === "object" ? (data.snapshot as Record<string, unknown>) : {};
  if (Array.isArray(snapshot.files)) {
    for (const file of snapshot.files) {
      if (typeof file === "string" && file) files.push(file);
    }
  }
  if (line.type === TYPE_ASSISTANT && Array.isArray(data.content)) {
    for (const part of data.content) {
      if (!part || typeof part !== "object") continue;
      const block = part as Record<string, unknown>;
      if (block.type !== CONTENT_TOOL) continue;
      const state = block.state && typeof block.state === "object" ? (block.state as Record<string, unknown>) : {};
      const input = state.input && typeof state.input === "object" ? (state.input as Record<string, unknown>) : {};
      const file = input.path ?? input.file_path;
      if (typeof file === "string" && file) files.push(file);
    }
  }
  return files;
}

function parseRaw(raw: string): RawLine[] {
  const out: RawLine[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as RawLine);
    } catch {
      /* skip a bad line */
    }
  }
  return out;
}

/** OpenCode sessions in one shared sqlite file. Freshness is the last message id. */
export class OpenCodeAdapter implements Adapter {
  readonly tool = TOOL_OPENCODE;

  constructor(
    private readonly dbPath = path.join(os.homedir(), ".local", "share", "opencode", DB_FILENAME),
  ) {}

  ownsTranscript(transcriptPath: string): boolean {
    return path.basename(transcriptPath) === DB_FILENAME;
  }

  discoverSessions(repoPath: string): DiscoveredSession[] {
    const db = openDb(this.dbPath);
    if (!db) return [];
    try {
      const rows = db.prepare(SESSION_SQL).all() as { id: string; directory: string; path: string | null }[];
      return rows
        .filter((row) => samePath(row.directory, repoPath) || (row.path ? samePath(row.path, repoPath) : false))
        .map((row) => ({ sessionId: row.id, transcriptPath: this.dbPath, repo: repoPath }));
    } catch {
      return [];
    } finally {
      db.close();
    }
  }

  readTranscript(transcriptPath: string, fromOffset = 0): ReadResult {
    return this.readNew({ transcript_path: transcriptPath, last_distilled_offset: fromOffset });
  }

  hasNewActivity(record: SessionCursor): boolean {
    return this.pending(record).length > 0;
  }

  unreadBytes(record: SessionCursor): number {
    return this.pending(record).length > 0 ? ROW_ACTIVITY_BYTES : 0;
  }

  readNew(record: SessionCursor): ReadResult {
    const pending = this.pending(record);
    if (pending.length === 0) {
      return { raw: "", newOffset: record.last_distilled_offset, cursor: record.last_distilled_cursor };
    }
    const lines = pending.map((message) => {
      let data: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(message.data);
        if (parsed && typeof parsed === "object") data = parsed as Record<string, unknown>;
      } catch {
        /* keep an empty body */
      }
      return JSON.stringify({
        type: message.type,
        timestamp: new Date(message.time_created).toISOString(),
        data,
      });
    });
    return {
      raw: lines.join("\n"),
      newOffset: record.last_distilled_offset,
      cursor: pending[pending.length - 1].id,
    };
  }

  normalizeEvents(raw: string): NormalizedEvent[] {
    return parseRaw(raw).flatMap(eventsFromLine);
  }

  extractMeta(raw: string): TranscriptMeta {
    const files = new Set<string>();
    let firstTs: string | undefined;
    let lastTs: string | undefined;
    for (const line of parseRaw(raw)) {
      if (line.timestamp) {
        if (!firstTs) firstTs = line.timestamp;
        lastTs = line.timestamp;
      }
      for (const file of filesFromLine(line)) files.add(file);
    }
    return { branches: [], files: [...files], firstTs, lastTs };
  }

  private pending(record: SessionCursor): MessageRow[] {
    if (!record.session_id) return [];
    const db = openDb(record.transcript_path || this.dbPath);
    if (!db) return [];
    try {
      const messages = db.prepare(MESSAGES_SQL).all(record.session_id) as unknown as MessageRow[];
      return rowsAfter(messages, record.last_distilled_cursor);
    } catch {
      return [];
    } finally {
      db.close();
    }
  }
}
