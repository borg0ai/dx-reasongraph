import { fileURLToPath } from "node:url";

/** Absolute path to this package's built CLI entry (dist/cli.js). */
export function selfCliPath(): string {
  return fileURLToPath(import.meta.url);
}

export function nodeBin(): string {
  return process.execPath;
}

/**
 * Run the npm CLI when available; otherwise use this package's exact entry.
 */
export function hookInvocation(sub: string): string {
  return `if command -v reasongraph >/dev/null 2>&1; then reasongraph ${sub}; else ${hookFallback(sub)}; fi`;
}

/** Just the node-based fallback invocation (no PATH lookup). */
export function hookFallback(sub: string): string {
  return `"${nodeBin()}" "${selfCliPath()}" ${sub}`;
}
