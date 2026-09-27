import * as fs from "node:fs";
import * as path from "node:path";
import { ReadResult, SessionCursor } from "./types.js";
import { fileSize } from "../util/fsx.js";

/** Read a JSONL file from a byte offset. A short read returns the new size. */
export function readJsonlSpan(file: string, fromOffset = 0): ReadResult {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    if (fromOffset >= size) return { raw: "", newOffset: size };
    const length = size - fromOffset;
    const buf = Buffer.alloc(length);
    fs.readSync(fd, buf, 0, length, fromOffset);
    return { raw: buf.toString("utf8"), newOffset: size };
  } finally {
    fs.closeSync(fd);
  }
}

export function jsonlHasNew(record: SessionCursor): boolean {
  return fileSize(record.transcript_path) > record.last_distilled_offset;
}

export function jsonlUnread(record: SessionCursor): number {
  return Math.max(0, fileSize(record.transcript_path) - record.last_distilled_offset);
}

/** First bytes of a JSONL file, enough for a leading session header. */
export function readHead(file: string, bytes = 8192): string {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, bytes);
    const buf = Buffer.alloc(length);
    fs.readSync(fd, buf, 0, length, 0);
    return buf.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

/** Every `*.jsonl` file under `dir`, depth-first. Missing dir yields []. */
export function walkJsonl(dir: string): string[] {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur) continue;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith(".jsonl")) out.push(full);
    }
  }
  return out;
}

export const JSONL_EXT = ".jsonl";

export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => path.resolve(p).replace(/[\\/]+$/, "");
  return norm(a) === norm(b);
}

/** True when `file` is `dir` or a descendant. A sibling with a shared prefix does not match. */
export function isUnderDir(file: string, dir: string): boolean {
  const root = path.resolve(dir);
  const target = path.resolve(file);
  if (target === root) return true;
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return target.startsWith(prefix);
}
