import * as fs from "node:fs";
import { repoRootFrom } from "./git.js";
import { reasongraphPaths } from "./paths.js";
import { reasongraphConfig, loadConfig } from "./config.js";

export interface Runtime {
  repoRoot: string;
  paths: reasongraphPaths;
  cfg: reasongraphConfig;
}

/** Resolve the repo + config for the current working directory. */
export function resolveRuntime(cwd = process.cwd()): Runtime | null {
  const repoRoot = repoRootFrom(cwd);
  if (!repoRoot) return null;
  return { repoRoot, paths: reasongraphPaths(repoRoot), cfg: loadConfig(repoRoot) };
}

/** True if `reasongraph init` has been run in this repo. */
export function isInitialized(paths: reasongraphPaths): boolean {
  return fs.existsSync(paths.stateDir) || fs.existsSync(paths.whyDir);
}
