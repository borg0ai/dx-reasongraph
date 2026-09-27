import * as fs from "node:fs";
import * as path from "node:path";
import { resolveRuntime, isInitialized } from "../util/runtime.js";
import { isDisabled } from "../util/config.js";
import { readState } from "../state/state.js";
import { discoverAndSync, sessionsNeedingDistill } from "../core/sweep.js";
import { claudeProjectDirFor } from "../util/paths.js";
import { hooksDir, trackedFilesUnder } from "../util/git.js";
import { whyPackGitStatus } from "../core/autocommit.js";
import { spawnSync } from "node:child_process";
import { say, warn } from "../util/log.js";

const OK = "✓";
const BAD = "✗";
const MEH = "•";

/** `reasongraph doctor` — health check. */
export function doctor(): number {
  const rt = resolveRuntime();
  if (!rt) {
    warn("not inside a git repository.");
    return 1;
  }

  let problems = 0;
  const line = (mark: string, msg: string) => say(`  ${mark} ${msg}`);

  say("reasongraph doctor");
  say("");

  // Initialized?
  if (isInitialized(rt.paths)) line(OK, "initialized (.ai/ present)");
  else {
    line(BAD, "not initialized — run `reasongraph init`");
    problems++;
  }

  // Disabled?
  if (isDisabled(rt.paths)) line(MEH, "hooks currently DISABLED (`reasongraph on` to re-enable)");

  // Plugin hooks are managed by the native agent plugin manager.

  // Self-only writes no shared agent instructions; shared setup uses AGENTS.md.
  if (!rt.cfg.selfOnly) {
    try {
      if (fs.readFileSync(path.join(rt.repoRoot, "AGENTS.md"), "utf8").includes("reasongraph:begin")) {
        line(OK, "AGENTS.md points agents at .reasongraph/why/");
      } else {
        line(MEH, "AGENTS.md has no ReasonGraph pointer — re-run init so agents know to read .reasongraph/why/");
      }
    } catch {
      line(MEH, "no AGENTS.md — agents won't be told to read .reasongraph/why/; re-run init");
    }
  }

  // git pre-push hook.
  if (prePushInstalled(rt.repoRoot)) line(OK, "git pre-push hook installed");
  else {
    line(BAD, "git pre-push hook missing — re-run init");
    problems++;
  }

  // Transcripts discoverable?
  const dir = claudeProjectDirFor(rt.repoRoot);
  if (fs.existsSync(dir)) line(OK, `transcripts directory found (${dir})`);
  else line(MEH, "no Claude Code transcripts found for this repo yet");

  // State health.
  const { state, corrupt } = readState(rt.paths);
  if (corrupt) {
    line(BAD, "state file is corrupt — run `reasongraph repair`");
    problems++;
  } else {
    discoverAndSync(rt.repoRoot, state);
    const total = Object.values(state.sessions).filter((r) => r.repo === rt.repoRoot).length;
    const dirty = sessionsNeedingDistill(rt.repoRoot, state).length;
    line(dirty > 0 ? MEH : OK, `${total} session(s) known, ${dirty} needing distill`);
  }

  // Why-pack git freshness — the two axes that let GitHub silently lag. In
  // self-only mode nothing is committed by design, so those axes don't apply.
  if (rt.cfg.selfOnly) {
    const tracked = trackedFilesUnder(rt.repoRoot, ".reasongraph/why");
    if (tracked.length) {
      line(
        BAD,
        `self-only mode, but ${tracked.length} file(s) under .reasongraph/why/ are already git-tracked — ` +
          "the exclude can't hide them; untrack them if they should remain private",
      );
      problems++;
    } else {
      line(OK, "self-only mode — why-packs are personal (not committed or shared)");
    }
  } else {
    const g = whyPackGitStatus(rt.repoRoot);
    if (g.uncommitted === 0 && g.unpushed === 0) {
      line(OK, "why-pack committed and pushed");
    } else {
      const bits: string[] = [];
      if (g.uncommitted > 0) bits.push(`${g.uncommitted} uncommitted`);
      if (g.unpushed > 0) bits.push(`${g.unpushed} unpushed`);
      line(MEH, `why-pack: ${bits.join(", ")} — \`reasongraph sync\` then \`git push\` to catch up`);
    }
  }

  // Backend availability.
  const backend = backendStatus();
  line(backend.ok ? OK : MEH, backend.msg);

  say("");
  if (problems === 0) say("All good.");
  else say(`${problems} problem(s) found.`);
  return problems === 0 ? 0 : 1;
}

function prePushInstalled(repoRoot: string): boolean {
  const hd = hooksDir(repoRoot);
  if (!hd) return false;
  try {
    return fs.readFileSync(path.join(hd, "pre-push"), "utf8").includes("reasongraph managed");
  } catch {
    return false;
  }
}

function backendStatus(): { ok: boolean; msg: string } {
  if (process.env.ANTHROPIC_API_KEY) return { ok: true, msg: "distiller backend: ANTHROPIC_API_KEY present" };
  const res = spawnSync("claude", ["--version"], { encoding: "utf8", timeout: 5000 });
  if (res.status === 0) return { ok: true, msg: `distiller backend: claude CLI (${(res.stdout || "").trim().split("\n")[0]})` };
  return { ok: false, msg: "distiller backend: no `claude` CLI and no ANTHROPIC_API_KEY — distillation will fail" };
}
