import * as path from "node:path";
import * as os from "node:os";

/**
 * All repo-relative locations ReasonGraph uses. `.ai/why/` is committed;
 * `.reasongraph/` holds repo configuration and gitignored local state.
 */
export function reasongraphPaths(repoRoot: string) {
  const aiDir = path.join(repoRoot, ".ai");
  const reasongraphDir = path.join(repoRoot, ".reasongraph");
  const stateDir = path.join(reasongraphDir, "state");
  return {
    repoRoot,
    aiDir,
    reasongraphDir,
    /** Committed why-packs, one markdown file per branch. */
    whyDir: path.join(aiDir, "why"),
    /** Local, gitignored state directory. */
    stateDir,
    /** State file reserved for the current on-disk state format. */
    stateFile: path.join(stateDir, "state.json"),
    /** One JSON file per session, so concurrent writers never clobber. */
    sessionsDir: path.join(stateDir, "sessions"),
    /** Per-session lockfiles, so overlapping distills of one session serialize. */
    locksDir: path.join(stateDir, "locks"),
    entriesFile: path.join(stateDir, "entries.json"),
    logsDir: path.join(stateDir, "logs"),
    localConfigFile: path.join(stateDir, "config.json"),
    disabledFlag: path.join(stateDir, "disabled"),
    /** Committed, shared ReasonGraph config. */
    sharedConfigFile: path.join(reasongraphDir, "config.json"),
  };
}

export type reasongraphPaths = ReturnType<typeof reasongraphPaths>;

/** Slugify a git branch name into a filesystem-safe why-pack basename. */
export function slugifyBranch(branch: string): string {
  const slug = branch
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "unknown";
}

/** Why-pack file path for a given branch. */
export function whyPackPath(paths: reasongraphPaths, branch: string): string {
  return path.join(paths.whyDir, `${slugifyBranch(branch)}.md`);
}

/** Per-session state file. The id is filesystem-safe (Claude session UUIDs). */
export function sessionFilePath(paths: reasongraphPaths, sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9._-]/g, "-");
  return path.join(paths.sessionsDir, `${safe}.json`);
}

/** Per-session distill lockfile. */
export function lockFilePath(paths: reasongraphPaths, sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9._-]/g, "-");
  return path.join(paths.locksDir, `${safe}.lock`);
}

/**
 * Claude Code stores transcripts under
 * ~/.claude/projects/<encoded-cwd>/<session>.jsonl where the encoding replaces
 * every non-alphanumeric character in the absolute path with '-'.
 */
export function encodeRepoPathForClaude(repoPath: string): string {
  return repoPath.replace(/[^a-zA-Z0-9]/g, "-");
}

export function claudeProjectsDir(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

export function claudeProjectDirFor(repoPath: string): string {
  return path.join(claudeProjectsDir(), encodeRepoPathForClaude(repoPath));
}
