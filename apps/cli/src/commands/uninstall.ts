import * as fs from "node:fs";
import * as path from "node:path";
import { resolveRuntime } from "../util/runtime.js";
import { hooksDir } from "../util/git.js";
import { writeFileAtomic } from "../util/fsx.js";
import {
  removeBlock,
  infoExcludePath,
  EXCLUDE_FENCE,
  CLAUDE_LOCAL_FENCE,
} from "../util/exclude.js";
import { say, warn } from "../util/log.js";

const GREP_BEGIN = "# >>> reasongraph managed >>>";
const GREP_END = "# <<< reasongraph managed <<<";

/**
 * `reasongraph uninstall` — remove the Git hook and local state. Committed why-packs and
 * shared config files are left in place (they're team artifacts).
 */
export function uninstall(): number {
  const rt = resolveRuntime();
  if (!rt) {
    warn("not inside a git repository.");
    return 1;
  }

  removePrePushBlock(rt.repoRoot);
  removeClaudeMdBlock(rt.repoRoot);
  removeSelfOnlyBlocks(rt.repoRoot);

  try {
    fs.rmSync(rt.paths.stateDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }

  say("reasongraph: removed Git hook and local state (.reasongraph/state).");
  say("Committed why-packs (.ai/why) and ReasonGraph config were left untouched.");
  return 0;
}

/**
 * Strip the self-only additions: our block in `.git/info/exclude` and the
 * personal pointer in CLAUDE.local.md. Harmless in non-self-only repos (the
 * blocks simply aren't there). Why-pack files are left on disk, as with the
 * shared uninstall.
 */
function removeSelfOnlyBlocks(repoRoot: string): void {
  const excl = infoExcludePath(repoRoot);
  if (excl) removeBlock(excl, EXCLUDE_FENCE);
  removeBlock(path.join(repoRoot, "CLAUDE.local.md"), CLAUDE_LOCAL_FENCE);
}

/** Strip the reasongraph pointer block from CLAUDE.md; remove the file if empty. */
function removeClaudeMdBlock(repoRoot: string): void {
  const file = path.join(repoRoot, "CLAUDE.md");
  let contents: string;
  try {
    contents = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  if (!contents.includes("<!-- reasongraph:begin -->")) return;
  const re = /\n?<!-- reasongraph:begin -->[\s\S]*?<!-- reasongraph:end -->\n?/g;
  const stripped = contents.replace(re, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!stripped) {
    try {
      fs.rmSync(file);
    } catch {
      /* ignore */
    }
    return;
  }
  writeFileAtomic(file, stripped + "\n");
}

function removePrePushBlock(repoRoot: string): void {
  const hd = hooksDir(repoRoot);
  if (!hd) return;
  const file = path.join(hd, "pre-push");
  let contents: string;
  try {
    contents = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  if (!contents.includes(GREP_BEGIN)) return;

  const re = new RegExp(`\\n?${escapeRe(GREP_BEGIN)}[\\s\\S]*?${escapeRe(GREP_END)}\\n?`, "g");
  const stripped = contents.replace(re, "\n").replace(/\n{3,}/g, "\n\n").trimEnd();

  // If nothing but a shebang remains, remove the file entirely.
  if (/^#!.*\n*$/.test(stripped + "\n") || stripped.trim() === "" || /^#![^\n]*$/.test(stripped.trim())) {
    try {
      fs.rmSync(file);
    } catch {
      /* ignore */
    }
    return;
  }
  writeFileAtomic(file, stripped + "\n");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
