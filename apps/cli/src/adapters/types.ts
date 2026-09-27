/**
 * The read-side is universal (markdown + grep). The write-side — turning a
 * tool's private transcript into normalized events — is per-tool. Every adapter
 * implements this interface so a Codex adapter is a small follow-up.
 */

export type NormalizedEventKind =
  | "user_text"
  | "assistant_text"
  | "thinking"
  | "tool_call_summary";

export interface NormalizedEvent {
  kind: NormalizedEventKind;
  /** Human-readable rendering of the event for the distiller. */
  text: string;
  /** For tool_call_summary: the tool name (Edit, Bash, ...). */
  tool?: string;
  /** ISO timestamp of the source line, if present. */
  timestamp?: string;
}

/** A session discovered on disk, before any distillation. */
export interface DiscoveredSession {
  sessionId: string;
  transcriptPath: string;
  /** Absolute repo path the transcript belongs to, if known. */
  repo?: string;
}

/** Metadata extracted cheaply from a transcript for state + branch matching. */
export interface TranscriptMeta {
  branches: string[];
  files: string[];
  cwd?: string;
  firstTs?: string;
  lastTs?: string;
}

export interface ReadResult {
  /** Newly-read bytes as text (from `fromOffset` to EOF). */
  raw: string;
  /** New byte offset (== file size at read time). JSONL adapters use this. */
  newOffset: number;
  /** Opaque per-session cursor. OpenCode stores the last message id here. */
  cursor?: string;
}

/** Fields an adapter needs to decide whether a session has undistilled input. */
export interface SessionCursor {
  transcript_path: string;
  last_distilled_offset: number;
  last_distilled_cursor?: string;
  /** State-map key. OpenCode needs it because every session shares one database file. */
  session_id?: string;
}

export interface Adapter {
  readonly tool: string;

  /**
   * True when this adapter is the one that can parse `transcriptPath`.
   * Checks are disjoint: a path belongs to at most one tool.
   */
  ownsTranscript(transcriptPath: string): boolean;

  /** Find sessions whose transcripts belong to `repoPath`. */
  discoverSessions(repoPath: string): DiscoveredSession[];

  /** Read a transcript (optionally incrementally from a byte offset). */
  readTranscript(transcriptPath: string, fromOffset?: number): ReadResult;

  /** Turn raw transcript text into the filtered, distiller-ready events. */
  normalizeEvents(raw: string): NormalizedEvent[];

  /** Cheap metadata pass for state + branch matching. */
  extractMeta(raw: string): TranscriptMeta;

  /** True when this session has input past the stored cursor. Not file size. */
  hasNewActivity(record: SessionCursor): boolean;

  /** Bytes still unread. Non-file adapters return a large value when rows are new. */
  unreadBytes(record: SessionCursor): number;

  /** Read only the undistilled span and report the cursor to store. */
  readNew(record: SessionCursor): ReadResult;
}
