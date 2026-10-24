import { resolveRuntime, isInitialized } from "../util/runtime.js";
import { readState } from "../state/state.js";
import { selectBackend } from "../distiller/backends.js";
import { distillSession } from "../core/distillSession.js";
import { discoverAndSync, sessionsNeedingDistill } from "../core/sweep.js";
import { autoCommitWhyPack } from "../core/autocommit.js";
import { say, warn, richOutput, style, renderBar, liveLine, clearLiveLine } from "../util/log.js";

interface DistillFlags {
  session?: string;
  branch?: string;
  allDirty?: boolean;
  /**
   * After distilling, commit the why-pack (only if config `sync` is "auto").
   * Set by the SessionEnd settle point — NOT by the 3-min auto-distill tick,
   * which would spam history.
   */
  commit?: boolean;
}

/**
 * `reasongraph distill [--session <id>] [--branch <name>] [--all-dirty]`
 * Also the entry point the SessionEnd hook calls in the background.
 */
export async function distill(flags: DistillFlags): Promise<number> {
  const rt = resolveRuntime();
  if (!rt) {
    warn("not inside a git repository.");
    return 1;
  }
  if (!isInitialized(rt.paths)) {
    warn("run `reasongraph init` first.");
    return 1;
  }

  const { state } = readState(rt.paths);
  discoverAndSync(rt.repoRoot, state);

  let targets: string[];
  if (flags.session) {
    targets = [flags.session];
  } else if (flags.allDirty) {
    targets = sessionsNeedingDistill(rt.repoRoot, state);
  } else {
    // Default: everything that needs it for this repo.
    targets = sessionsNeedingDistill(rt.repoRoot, state);
  }

  if (targets.length === 0) {
    say("reasongraph: nothing to distill — all sessions up to date.");
    return 0;
  }

  const backend = selectBackend(rt.cfg);
  const rich = richOutput();
  const started = Date.now();
  if (rich) {
    say(`${style.magenta("◆")} ${style.bold("reasongraph distill")} ${style.dim(`· ${targets.length} session(s) · ${backend.name}`)}`);
  }
  let changed = 0;
  let failed = 0;
  for (const [n, id] of targets.entries()) {
    const label = `[${n + 1}/${targets.length}] ${id.slice(0, 8)}`;
    const t0 = Date.now();
    const onProgress = rich
      ? (done: number, total: number) =>
          liveLine(`${style.cyan("›")} ${label} ${style.cyan(renderBar(done, total))} ${done}/${total} chunks`)
      : undefined;
    if (rich) liveLine(`${style.cyan("›")} ${label} ${style.dim("reading transcript…")}`);
    let res;
    try {
      res = await distillSession(rt.repoRoot, id, state, rt.cfg, backend, {
        branchOverride: flags.branch,
        onProgress,
      });
    } catch (e: any) {
      if (rich) clearLiveLine();
      warn(`distill ${id} failed: ${e.message}`);
      failed++;
      continue;
    }
    if (rich) clearLiveLine();
    if (!res.ok) {
      warn(`distill ${id}: ${res.reason ?? "failed"}`);
      failed++;
      continue;
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (res.changed && res.whyPack) {
      changed++;
      const parts: string[] = [];
      if (res.addedTitles.length) parts.push(`+${res.addedTitles.length} new`);
      if (res.updatedTitles.length) parts.push(`~${res.updatedTitles.length} updated`);
      if (rich) {
        say(`${style.green("✓")} ${label} ${style.bold(res.branch ?? "")} ${style.green(parts.join(", ") || "refreshed")} ${style.dim(`(${secs}s)`)}`);
      } else {
        say(`reasongraph: ${res.whyPack} (${res.branch}) — ${parts.join(", ") || "refreshed"}`);
      }
    } else if (rich) {
      say(`${style.dim("·")} ${label} ${style.dim(`no changes (${secs}s)`)}`);
    }
    if (res.partialFailures) {
      warn(`session ${id.slice(0, 8)}: ${res.partialFailures} chunk(s) failed and were skipped (partial coverage).`);
    }
  }
  if (rich) {
    const tone = failed > 0 ? style.yellow : style.green;
    say(`${tone("◆")} ${style.bold("done")} ${style.dim(`· ${changed} changed · ${failed} failed · ${((Date.now() - started) / 1000).toFixed(1)}s`)}`);
  }

  // distillSession persists each session it touches; nothing else to save.
  if (changed === 0 && failed === 0) say("reasongraph: no changes.");

  // Settle-point commit: make the why-pack durable so it rides the next push,
  // instead of drifting uncommitted. Only when asked (SessionEnd, not the
  // auto-distill tick) and only when the team opted into sync:"auto".
  if (flags.commit && rt.cfg.sync === "auto" && changed > 0) {
    const res = autoCommitWhyPack(rt.repoRoot);
    if (res.committed) {
      say(`reasongraph: committed ${(res.files ?? []).join(", ")} (${res.branch}) — rides your next push.`);
    }
  }
  return failed > 0 ? 1 : 0;
}
