import { Adapter } from "./types.js";
import { ClaudeCodeAdapter } from "./claude-code.js";
import { CodexAdapter } from "./codex.js";
import { CursorAgentAdapter } from "./cursor-agent.js";
import { OpenCodeAdapter } from "./opencode.js";

/** Active write-side adapters. Discovery sweeps every entry. */
export const ADAPTERS: Adapter[] = [
  new ClaudeCodeAdapter(),
  new CodexAdapter(),
  new OpenCodeAdapter(),
  new CursorAgentAdapter(),
];

/** Kept so callers can assert the stub list is empty after RFC 0007. */
export const STUBBED_ADAPTERS: Adapter[] = [];

export function adapterFor(tool: string): Adapter | undefined {
  return ADAPTERS.find((adapter) => adapter.tool === tool);
}

/**
 * The adapter that owns this transcript path. Undefined when none match, or
 * when more than one does — a tie means the ownership checks drifted and
 * guessing would repeat the wrong-parser bug.
 */
export function toolForTranscript(transcriptPath: string): string | undefined {
  const matches = ADAPTERS.filter((adapter) => adapter.ownsTranscript(transcriptPath));
  if (matches.length !== 1) return undefined;
  return matches[0].tool;
}

export * from "./types.js";
