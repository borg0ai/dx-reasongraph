import * as fs from "node:fs";
import * as path from "node:path";
import { resolveRuntime } from "../util/runtime.js";
import { reasongraphPaths } from "../util/paths.js";
import { defaultSharedConfig } from "../util/config.js";
import { ensureDir, writeFileAtomic } from "../util/fsx.js";
import { hookFallback } from "../util/self.js";
import { hooksDir, trackedFilesUnder } from "../util/git.js";
import {
  ensureBlock,
  infoExcludePath,
  EXCLUDE_FENCE,
} from "../util/exclude.js";
import { say, warn } from "../util/log.js";
import { readState } from "../state/state.js";
import { discoverAndSync, sessionsNeedingDistill } from "../core/sweep.js";
import { isNonInteractive, promptYesNo } from "../util/tty.js";
import { distill } from "./distill.js";

const GREP_BEGIN = "# >>> reasongraph managed >>>";
const GREP_END = "# <<< reasongraph managed <<<";

export interface InitOptions {
  /** Personal mode: commit nothing, ignore artifacts via `.git/info/exclude`. */
  selfOnly?: boolean;
}

export async function init(opts: InitOptions = {}): Promise<number> {
  const rt = resolveRuntime();
  if (!rt) {
    warn("not inside a git repository. Run `git init` first, then `reasongraph init`.");
    return 1;
  }
  const { repoRoot } = rt;
  const paths = reasongraphPaths(repoRoot);
  const selfOnly = opts.selfOnly === true;

  if (!migrateLegacyWhyPacks(repoRoot, paths.whyDir, selfOnly)) return 1;

  ensureDir(path.dirname(paths.sharedConfigFile));

  // 1. Directories.
  ensureDir(paths.whyDir);
  ensureDir(paths.stateDir);
  ensureDir(paths.logsDir);
  const gitkeep = path.join(paths.whyDir, ".gitkeep");
  if (!fs.existsSync(gitkeep)) fs.writeFileSync(gitkeep, "");

  // 2 + 3. Config and ignoring. Self-only diverges here: nothing shared is
  // written or committed — the mode lives in local config and the artifacts are
  // ignored via the repo's private `.git/info/exclude`.
  if (selfOnly) {
    setupSelfOnly(repoRoot, paths);
  } else {
    setupShared(repoRoot, paths);
  }

  // Shared pointer belongs in the agent instruction file loaded by this repo.
  const agentsMdResult = selfOnly ? "skipped (self-only)" : ensureAgentsMd(repoRoot);

  // Agent lifecycle hooks are owned by the installed ReasonGraph plugin.
  // Git pre-push is outside agent plugin lifecycle, so init owns it.
  const prePushResult = installPrePushHook(repoRoot);

  // 6. Explain.
  say("");
  say(selfOnly ? "reasongraph initialized (self-only, personal mode)." : "reasongraph initialized.");
  say("");
  say("Installed:");
  if (selfOnly) {
    say(`  • .reasongraph/why/   personal why-packs (never committed)`);
    say(`  • .git/info/exclude   ignores ReasonGraph data (private)`);
    say(`  • AGENTS.md pointer   skipped in self-only mode`);
  } else {
    say(`  • .reasongraph/why/   shared why-packs (committed — this is what everyone reads)`);
    say(`  • .reasongraph/config.json team config (committed)`);
    say(`  • .reasongraph/state/    local state (gitignored)`);
    say(`  • AGENTS.md pointer   ${agentsMdResult} (tells agents to read .reasongraph/why/)`);
  }
  say("  • Agent hooks         run `reasongraph install` to install the plugin");
  say(`  • git pre-push hook   ${prePushResult}`);
  say("");
  if (selfOnly) {
    say("Self-only mode:");
    say("  Nothing reasongraph produces is committed or shared. Why-packs are personal");
    say("  notes for you and your own future agents, ignored via .git/info/exclude.");
  } else {
    say("Privacy model:");
    say("  Your session transcript never leaves this machine. At session end (and as a");
    say("  catch-up at git push) ReasonGraph distills a privacy-filtered digest of the");
    say("  decisions — never your messages, never your questions — into .reasongraph/why/. That");
    say("  markdown is the only shared artifact. Review before pushing; edits are kept.");
  }
  say("");
  say("Now just work. `claude`, let the agent commit, `git push`. That's it.");

  // 7. Offer to backfill from any prior local sessions for this repo.
  return offerBackfill(repoRoot);
}

/** Move old packs once; preflight every collision before changing either tree. */
function migrateLegacyWhyPacks(repoRoot: string, whyDir: string, selfOnly: boolean): boolean {
  const legacyDir = path.join(repoRoot, ".ai", "why");
  if (!fs.existsSync(legacyDir)) return true;

  const packs = fs.readdirSync(legacyDir).filter((name) => name.endsWith(".md"));
  const conflicts = packs.filter((name) => fs.existsSync(path.join(whyDir, name)));
  if (conflicts.length) {
    warn(`cannot migrate .ai/why/: destination already has ${conflicts.join(", ")}`);
    return false;
  }

  if (!packs.length) return true;
  ensureDir(whyDir);
  for (const name of packs) {
    const source = path.join(legacyDir, name);
    const destination = path.join(whyDir, name);
    if (selfOnly) fs.copyFileSync(source, destination);
    else fs.renameSync(source, destination);
  }
  if (!selfOnly && fs.readdirSync(legacyDir).length === 0) fs.rmdirSync(legacyDir);
  return true;
}

/**
 * If this machine already has undistilled Claude sessions for the repo (the
 * common "adopting ReasonGraph on an existing project" case), offer to distill
 * them now. Interactive + default No: init stays fast and idempotent unless the
 * human explicitly opts in, and never runs a slow LLM job on CI or a stray key.
 * We distill into the working tree only — reviewing and committing stays the
 * human's call, exactly like the pre-push flow. Never commits, never stages.
 */
async function offerBackfill(repoRoot: string): Promise<number> {
  // Cheap: discover lists transcript files and stats sizes — no parsing, no LLM.
  const { state } = readState(reasongraphPaths(repoRoot));
  discoverAndSync(repoRoot, state);
  const pending = sessionsNeedingDistill(repoRoot, state);
  if (pending.length === 0) return 0;

  const n = pending.length;
  const plural = n === 1 ? "session" : "sessions";
  if (isNonInteractive()) {
    say("");
    say(`reasongraph: found ${n} prior Claude ${plural} for this repo not yet distilled.`);
    say("  Run `reasongraph distill` to seed the why-pack from your local history.");
    return 0;
  }

  say("");
  const yes = promptYesNo(
    `reasongraph: found ${n} prior Claude ${plural} for this repo.\n` +
      `  Distill them into a why-pack now? Runs the LLM locally, may take a few min.\n` +
      `  (Nothing is committed — you review .reasongraph/why/ before sharing.) [y/N] `,
  );
  if (!yes) {
    say("  Skipped. Run `reasongraph distill` whenever you're ready to backfill.");
    return 0;
  }

  say("");
  say(`reasongraph: distilling ${n} ${plural}… (Ctrl-C to stop; partial progress is kept)`);
  const code = await distill({ allDirty: true });
  say("");
  say("reasongraph: backfill done. Review .reasongraph/why/ before you commit — nothing was staged.");
  return code;
}

/** Shared/team setup: committed config + local placeholder + shared gitignore. */
function setupShared(repoRoot: string, paths: reasongraphPaths): void {
  ensureDir(path.dirname(paths.sharedConfigFile));
  if (!fs.existsSync(paths.sharedConfigFile)) {
    writeFileAtomic(paths.sharedConfigFile, JSON.stringify(defaultSharedConfig(), null, 2) + "\n");
  }
  if (!fs.existsSync(paths.localConfigFile)) {
    writeFileAtomic(paths.localConfigFile, JSON.stringify({}, null, 2) + "\n");
  }
  ensureGitignore(repoRoot);
}

/**
 * Personal setup: persist the mode locally, ignore artifacts via the repo's
 * private `.git/info/exclude` for ReasonGraph artifacts. Writes nothing
 * shared/committable, including agent instruction files.
 */
function setupSelfOnly(repoRoot: string, paths: reasongraphPaths): void {
  const local = readLocalConfig(paths);
  local.selfOnly = true;
  writeFileAtomic(paths.localConfigFile, JSON.stringify(local, null, 2) + "\n");

  // `.git/info/exclude` (like .gitignore) can't hide already-tracked files —
  // warn but proceed so the mode still applies to everything not yet committed.
  const tracked = trackedFilesUnder(repoRoot, ".reasongraph/why");
  if (tracked.length) {
    warn(
      `${tracked.length} file(s) under .reasongraph/why/ are already git-tracked; the self-only ` +
        "exclude can't hide them. Untrack them yourself if they should remain private.",
    );
  }
  // Ignore personal why-packs and state.
  const excl = infoExcludePath(repoRoot);
  if (excl) ensureBlock(excl, EXCLUDE_FENCE, [".reasongraph/why/", ".reasongraph/state/"]);
  else warn("could not resolve .git/info/exclude — artifacts were not ignored.");

}

function readLocalConfig(paths: reasongraphPaths): Record<string, unknown> {
  try {
    const parsed = JSON.parse(fs.readFileSync(paths.localConfigFile, "utf8"));
    // Guard against a hand-corrupted config (null/array/primitive) so setting
    // `.selfOnly` below can't throw and abort init.
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function ensureGitignore(repoRoot: string): void {
  const file = path.join(repoRoot, ".gitignore");
  const wanted = [".reasongraph/state/"];
  let contents = "";
  try {
    contents = fs.readFileSync(file, "utf8");
  } catch {
    /* no gitignore yet */
  }
  const present = new Set(contents.split("\n").map((l) => l.trim()));
  const missing = wanted.filter((l) => !present.has(l));
  if (missing.length === 0) return;
  const prefix = contents && !contents.endsWith("\n") ? "\n" : "";
  fs.appendFileSync(file, `${prefix}\n# ReasonGraph local state (per-machine)\n${missing.join("\n")}\n`);
}

const AGENTS_MD_BEGIN = "<!-- reasongraph:begin -->";
const AGENTS_MD_END = "<!-- reasongraph:end -->";
const AGENTS_MD_BLOCK = `${AGENTS_MD_BEGIN}
## Design reasoning lives in \`.reasongraph/why/\`

This repo records the *why* behind its code in \`.reasongraph/why/<branch>.md\` ("why-packs"),
distilled from AI coding sessions. **The why-pack is the ground truth for *why* —
prefer it over commit messages, which are lossy and can be out of date.**

- Before working on unfamiliar code, run \`reasongraph context <file>\` (or grep
  \`.reasongraph/why/\`) to see the decisions that touch it.
- When asked what changed on a branch, or *why* something is the way it is, read
  \`.reasongraph/why/<branch>.md\` — not just \`git log\`.
- \`grep -rn "agent-initiated" .reasongraph/why/\` surfaces decisions an agent made
  unilaterally, with no human sign-off — scrutinize these first.

Commits titled \`reasongraph: update why-pack (…)\` are written by the tool (the
why-pack only, via a scratch index — they never touch your staged work). They're
safe to rebase past or drop; don't amend them into your feature commits.
${AGENTS_MD_END}`;

/**
 * Point agents at the why-packs from AGENTS.md. This is the read-side trigger for the "explain / review /
 * what changed" moments, which are conversations, not edits, so no PreToolUse
 * hook fires. Idempotent; never clobbers existing content.
 */
export function ensureAgentsMd(repoRoot: string): string {
  const file = path.join(repoRoot, "AGENTS.md");
  let existing = "";
  try {
    existing = fs.readFileSync(file, "utf8");
  } catch {
    /* no AGENTS.md yet */
  }
  if (existing.includes(AGENTS_MD_BEGIN)) {
    // Refresh the managed block in place if it's out of date (e.g. this machine
    // upgraded reasongraph). Only our marked region is touched; the rest is the
    // user's. Idempotent when already current.
    const re = new RegExp(`${escapeRe(AGENTS_MD_BEGIN)}[\\s\\S]*?${escapeRe(AGENTS_MD_END)}`);
    const current = existing.match(re)?.[0];
    if (current === AGENTS_MD_BLOCK) return "already present";
    writeFileAtomic(file, existing.replace(re, AGENTS_MD_BLOCK));
    return "updated";
  }
  if (!existing.trim()) {
    fs.writeFileSync(file, AGENTS_MD_BLOCK + "\n");
    return "created";
  }
  const prefix = existing.endsWith("\n") ? "" : "\n";
  fs.appendFileSync(file, `${prefix}\n${AGENTS_MD_BLOCK}\n`);
  return "appended";
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function installPrePushHook(repoRoot: string): string {
  const hd = hooksDir(repoRoot);
  if (!hd) return "SKIPPED (no hooks dir)";
  ensureDir(hd);
  const file = path.join(hd, "pre-push");

  const managed = [
    GREP_BEGIN,
    "if command -v reasongraph >/dev/null 2>&1; then",
    "  reasongraph hook pre-push || true",
    "else",
    `  ${hookFallback("hook pre-push")} || true`,
    "fi",
    GREP_END,
    "",
  ].join("\n");

  let existing = "";
  if (fs.existsSync(file)) existing = fs.readFileSync(file, "utf8");

  if (existing.includes(GREP_BEGIN)) {
    return "already present";
  }

  let out: string;
  let verb: string;
  if (!existing.trim()) {
    out = `#!/bin/sh\n${managed}`;
    verb = "installed";
  } else {
    // Chain: append our guarded block to the existing hook, never clobber.
    const prefix = existing.endsWith("\n") ? "" : "\n";
    out = `${existing}${prefix}\n${managed}`;
    verb = "chained onto existing hook";
  }
  writeFileAtomic(file, out);
  try {
    fs.chmodSync(file, 0o755);
  } catch {
    /* best effort */
  }

  const managers: string[] = [];
  if (fs.existsSync(path.join(repoRoot, ".husky"))) managers.push("husky");
  if (
    fs.existsSync(path.join(repoRoot, "lefthook.yml")) ||
    fs.existsSync(path.join(repoRoot, "lefthook.yaml"))
  )
    managers.push("lefthook");
  if (managers.length) {
    say(`  (detected ${managers.join(", ")} — reasongraph's block was chained; keep it if you re-run their install)`);
  }

  return verb;
}
