import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  Adapter,
  DiscoveredSession,
  NormalizedEvent,
  ReadResult,
  SessionCursor,
  TranscriptMeta,
} from "./types.js";
import { jsonlHasNew, jsonlUnread, readJsonlSpan } from "./jsonl.js";
import { TOOL_CURSOR_AGENT } from "./names.js";

const EDITING_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const ARG_LIMIT = 180;

interface CursorLine {
  role?: string;
  message?: { content?: unknown };
}

function parseLines(raw: string): CursorLine[] {
  const out: CursorLine[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // Truncated final line is skipped.
    }
  }
  return out;
}

function toolSummary(name: string, input: Record<string, unknown> | undefined): string {
  const file = input?.file_path ?? input?.path ?? input?.notebook_path;
  const command = typeof input?.command === "string" ? input.command.split("\n")[0] : "";
  if (typeof file === "string" && command) return `${name} ${file}: ${command.slice(0, ARG_LIMIT)}`;
  if (typeof file === "string") return `${name} ${file}`;
  if (command) return `${name}: ${command.slice(0, ARG_LIMIT)}`;
  return name;
}

/** Cursor's project folder is the absolute path with non-alphanumerics replaced. */
export function cursorProjectSlug(repoPath: string): string {
  return path.resolve(repoPath).replace(/[^a-zA-Z0-9]/g, "-").replace(/^-+/, "");
}

/**
 * cursor-agent JSONL under ~/.cursor/projects/<slug>/agent-transcripts.
 * store.db blobs are not read.
 */
export class CursorAgentAdapter implements Adapter {
  readonly tool = TOOL_CURSOR_AGENT;

  constructor(private readonly projectsRoot = path.join(os.homedir(), ".cursor", "projects")) {}

  discoverSessions(repoPath: string): DiscoveredSession[] {
    const dir = path.join(this.projectsRoot, cursorProjectSlug(repoPath), "agent-transcripts");
    const out: DiscoveredSession[] = [];
    let sessions: string[] = [];
    try {
      sessions = fs.readdirSync(dir);
    } catch {
      return out;
    }
    for (const id of sessions) {
      const file = path.join(dir, id, `${id}.jsonl`);
      if (!fs.existsSync(file)) continue;
      out.push({ sessionId: id, transcriptPath: file, repo: repoPath });
    }
    return out;
  }

  readTranscript(transcriptPath: string, fromOffset = 0): ReadResult {
    return readJsonlSpan(transcriptPath, fromOffset);
  }

  hasNewActivity(record: SessionCursor): boolean {
    return jsonlHasNew(record);
  }

  unreadBytes(record: SessionCursor): number {
    return jsonlUnread(record);
  }

  readNew(record: SessionCursor): ReadResult {
    return this.readTranscript(record.transcript_path, record.last_distilled_offset);
  }

  normalizeEvents(raw: string): NormalizedEvent[] {
    const events: NormalizedEvent[] = [];
    for (const line of parseLines(raw)) {
      const content = line.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content as { type?: string; text?: string; name?: string; input?: Record<string, unknown> }[]) {
        if (!block || typeof block !== "object") continue;
        if (block.type === "text" && block.text?.trim()) {
          const kind = line.role === "user" ? "user_text" : "assistant_text";
          events.push({ kind, text: block.text.trim() });
        } else if (block.type === "thinking" && block.text?.trim()) {
          events.push({ kind: "thinking", text: block.text.trim() });
        } else if (block.type === "tool_use") {
          const tool = block.name || "tool";
          events.push({ kind: "tool_call_summary", tool, text: toolSummary(tool, block.input) });
        }
      }
    }
    return events;
  }

  extractMeta(raw: string): TranscriptMeta {
    const files = new Set<string>();
    for (const line of parseLines(raw)) {
      const content = line.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content as { type?: string; name?: string; input?: { file_path?: string; path?: string } }[]) {
        if (block?.type !== "tool_use" || !block.name || !EDITING_TOOLS.has(block.name)) continue;
        const file = block.input?.file_path || block.input?.path;
        if (file) files.add(file);
      }
    }
    return { branches: [], files: [...files] };
  }
}
