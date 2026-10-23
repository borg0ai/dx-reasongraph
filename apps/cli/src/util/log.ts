import * as fs from "node:fs";
import * as path from "node:path";

export type ProgressTone = "success" | "info" | "warning" | "error";

const PROGRESS_MARKS: Record<ProgressTone, { mark: string; color: number }> = {
  success: { mark: "✓", color: 32 },
  info: { mark: "›", color: 36 },
  warning: { mark: "!", color: 33 },
  error: { mark: "✗", color: 31 },
};

/** User-facing stdout line (kept terse — hooks print into git output). */
export function say(msg: string): void {
  process.stdout.write(msg + "\n");
}

export function supportsColor(
  isTTY: boolean,
  noColor: string | undefined,
): boolean {
  return isTTY && noColor === undefined;
}

export function formatProgress(
  message: string,
  tone: ProgressTone,
  colorEnabled: boolean,
): string {
  const { mark, color } = PROGRESS_MARKS[tone];
  const icon = colorEnabled ? `\u001b[${color}m${mark}\u001b[0m` : mark;
  return `${icon} ${message}`;
}

export function progress(
  message: string,
  tone: ProgressTone = "success",
): void {
  say(
    formatProgress(
      message,
      tone,
      supportsColor(Boolean(process.stdout.isTTY), process.env.NO_COLOR),
    ),
  );
}

/** Non-fatal warning to stderr. */
export function warn(msg: string): void {
  process.stderr.write(`reasongraph: ${msg}\n`);
}

/**
 * Append a line to a background log file. Used by detached distill runs whose
 * stdout/stderr nobody is watching. Never throws.
 */
export function appendLog(logsDir: string, name: string, msg: string): void {
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    const line = `${isoNow()} ${msg}\n`;
    fs.appendFileSync(path.join(logsDir, name), line);
  } catch {
    // logging must never break the caller
  }
}

/**
 * ISO timestamp helper. Isolated here so tests can reason about it; real time
 * is fine in production (unlike workflow scripts, the CLI may read the clock).
 */
export function isoNow(): string {
  return new Date().toISOString();
}
