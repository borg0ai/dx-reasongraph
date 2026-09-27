import { reasongraphPaths } from "../util/paths.js";
import { isoNow } from "../util/log.js";
import { listWorktrees } from "../util/git.js";
import { ADAPTERS, adapterFor } from "../adapters/index.js";
import { SessionCursor } from "../adapters/types.js";
import { StateFile, SessionRecord, upsertSession, writeSession } from "../state/state.js";
import { correctSessionTool } from "./sessionTool.js";

/**
 * Reconcile state with the transcripts on disk across EVERY worktree of the
 * repo family (crash recovery + the "push from any worktree" fix). A session
 * that ran in worktree B is found even when you sweep from worktree A. Each
 * session records the worktree it ran in as `repo`; state itself is stored in
 * the sweeping tree. Cheap: directory listing + stat, no transcript parsing.
 */
export function discoverAndSync(repoRoot: string, state: StateFile): number {
  const paths = reasongraphPaths(repoRoot);
  const now = isoNow();
  let added = 0;
  for (const worktree of listWorktrees(repoRoot)) {
    for (const adapter of ADAPTERS) {
      for (const found of adapter.discoverSessions(worktree)) {
        if (!state.sessions[found.sessionId]) {
          const rec = upsertSession(
            state,
            found.sessionId,
            {
              tool: adapter.tool,
              transcript_path: found.transcriptPath,
              repo: worktree,
              status: "dirty",
            },
            now,
          );
          writeSession(paths, found.sessionId, rec);
          added++;
        } else {
          // Keep transcript path fresh in case the encoding/home moved.
          const rec = state.sessions[found.sessionId];
          rec.transcript_path = found.transcriptPath;
          if (correctSessionTool(rec)) writeSession(paths, found.sessionId, rec);
        }
      }
    }
  }
  return added;
}

/**
 * Sessions that need (re)distillation: explicitly dirty, or whose transcript
 * grew past the last distilled offset (stale). Scoped to the repo's worktree
 * family, so a push from any worktree considers the whole family's sessions.
 */
export function sessionsNeedingDistill(repoRoot: string, state: StateFile): string[] {
  const family = new Set(listWorktrees(repoRoot));
  const ids: string[] = [];
  for (const [id, rec] of Object.entries(state.sessions)) {
    if (!family.has(rec.repo)) continue;
    const grew = sessionHasNewActivity(id, rec);
    if (rec.status === "dirty" || grew) ids.push(id);
  }
  return ids;
}

/** Freshness is the adapter's job. JSONL uses a byte offset; OpenCode uses a message id. */
export function sessionHasNewActivity(sessionId: string, rec: SessionRecord): boolean {
  const adapter = adapterFor(rec.tool);
  if (!adapter) return false;
  const cursor: SessionCursor = { ...rec, session_id: sessionId };
  return adapter.hasNewActivity(cursor);
}

