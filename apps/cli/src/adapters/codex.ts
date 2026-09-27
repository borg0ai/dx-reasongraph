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
import { isUnderDir, JSONL_EXT, jsonlHasNew, jsonlUnread, readHead, readJsonlSpan, samePath, walkJsonl } from "./jsonl.js";
import { TOOL_CODEX } from "./names.js";

const ARG_LIMIT = 180;

interface CodexLine {
  type?: string;
  timestamp?: string;
  payload?: {
    id?: string;
    cwd?: string;
    git?: { branch?: string };
    type?: string;
    role?: string;
    name?: string;
    arguments?: string;
    content?: { type?: string; text?: string }[];
    summary?: unknown;
  };
}

function parseLines(raw: string): CodexLine[] {
  const out: CodexLine[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // Truncated final line from a crashed session is skipped.
    }
  }
  return out;
}

function textOf(content: { type?: string; text?: string }[] | undefined): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (typeof block?.text === "string" ? block.text.trim() : ""))
    .filter(Boolean)
    .join("\n");
}

function reasoningText(summary: unknown): string {
  if (typeof summary === "string") return summary.trim();
  if (!Array.isArray(summary)) return "";
  return summary
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object" && "text" in item && typeof item.text === "string") return item.text.trim();
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function toolSummary(name: string, args: string | undefined): string {
  let parsed: Record<string, unknown> = {};
  if (args) {
    try {
      const value = JSON.parse(args);
      if (value && typeof value === "object") parsed = value as Record<string, unknown>;
    } catch {
      return `${name}: ${args.slice(0, ARG_LIMIT)}`;
    }
  }
  const file = parsed.file_path ?? parsed.path ?? parsed.notebook_path;
  const command = typeof parsed.command === "string" ? parsed.command.split("\n")[0] : "";
  if (typeof file === "string" && command) return `${name} ${file}: ${command.slice(0, ARG_LIMIT)}`;
  if (typeof file === "string") return `${name} ${file}`;
  if (command) return `${name}: ${command.slice(0, ARG_LIMIT)}`;
  return name;
}

/** Codex rollout JSONL under ~/.codex/sessions, matched on the recorded cwd. */
export class CodexAdapter implements Adapter {
  readonly tool = TOOL_CODEX;

  constructor(private readonly sessionsRoot = path.join(os.homedir(), ".codex", "sessions")) {}

  ownsTranscript(transcriptPath: string): boolean {
    return transcriptPath.endsWith(JSONL_EXT) && isUnderDir(transcriptPath, this.sessionsRoot);
  }

  discoverSessions(repoPath: string): DiscoveredSession[] {
    const out: DiscoveredSession[] = [];
    for (const file of walkJsonl(this.sessionsRoot)) {
      let head = "";
      try {
        head = readHead(file);
      } catch {
        continue;
      }
      const meta = parseLines(head).find((line) => line.type === "session_meta");
      const cwd = meta?.payload?.cwd;
      if (!cwd || !samePath(cwd, repoPath)) continue;
      const sessionId = meta?.payload?.id || path.basename(file, ".jsonl");
      out.push({ sessionId, transcriptPath: file, repo: repoPath });
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
      const payload = line.payload;
      if (!payload || line.type !== "response_item") continue;
      const ts = line.timestamp;
      if (payload.type === "message") {
        if (payload.role !== "user" && payload.role !== "assistant") continue;
        const text = textOf(payload.content);
        if (!text) continue;
        events.push({
          kind: payload.role === "user" ? "user_text" : "assistant_text",
          text,
          timestamp: ts,
        });
      } else if (payload.type === "reasoning") {
        const text = reasoningText(payload.summary);
        if (text) events.push({ kind: "thinking", text, timestamp: ts });
      } else if (payload.type === "function_call") {
        const tool = payload.name || "tool";
        events.push({
          kind: "tool_call_summary",
          tool,
          text: toolSummary(tool, payload.arguments),
          timestamp: ts,
        });
      }
    }
    return events;
  }

  extractMeta(raw: string): TranscriptMeta {
    const branches = new Set<string>();
    const files = new Set<string>();
    let cwd: string | undefined;
    let firstTs: string | undefined;
    let lastTs: string | undefined;
    for (const line of parseLines(raw)) {
      if (line.timestamp) {
        if (!firstTs) firstTs = line.timestamp;
        lastTs = line.timestamp;
      }
      const payload = line.payload;
      if (line.type === "session_meta") {
        if (payload?.cwd) cwd = payload.cwd;
        if (payload?.git?.branch) branches.add(payload.git.branch);
      }
      if (line.type === "response_item" && payload?.type === "function_call" && payload.arguments) {
        try {
          const args = JSON.parse(payload.arguments) as { file_path?: string; path?: string };
          const file = args.file_path || args.path;
          if (file) files.add(file);
        } catch {
          /* arguments are not always JSON */
        }
      }
    }
    return { branches: [...branches], files: [...files], cwd, firstTs, lastTs };
  }
}
