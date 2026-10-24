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

/** True when stdout is a color-capable terminal (never inside hooks or pipes). */
export function richOutput(): boolean {
  return supportsColor(Boolean(process.stdout.isTTY), process.env.NO_COLOR);
}

/** Wrap text in an ANSI style; plain text when `enabled` is false. */
export function paint(code: number, text: string, enabled: boolean = richOutput()): string {
  return enabled ? `\u001b[${code}m${text}\u001b[0m` : text;
}

export const style = {
  bold: (t: string) => paint(1, t),
  dim: (t: string) => paint(2, t),
  red: (t: string) => paint(31, t),
  green: (t: string) => paint(32, t),
  yellow: (t: string) => paint(33, t),
  magenta: (t: string) => paint(35, t),
  cyan: (t: string) => paint(36, t),
};

/** Fixed-width progress bar, e.g. `███░░░░░`. */
export function renderBar(done: number, total: number, width = 20): string {
  const filled = total > 0 ? Math.round((Math.min(done, total) / total) * width) : 0;
  return "█".repeat(filled) + "░".repeat(width - filled);
}

/** Rewrite the current terminal line in place (TTY only). */
export function liveLine(text: string): void {
  process.stdout.write(`\r\u001b[2K${text}`);
}

export function clearLiveLine(): void {
  process.stdout.write("\r\u001b[2K");
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
