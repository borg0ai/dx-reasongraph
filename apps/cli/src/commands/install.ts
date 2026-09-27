import { spawnSync } from "node:child_process";
import { resolveRuntime } from "../util/runtime.js";
import { say, warn } from "../util/log.js";

/** Arguments for adding this repository's plugin through Vercel's plugins CLI. */
export function pluginInstallArgs(): string[] {
  return ["--yes", "plugins", "add", "borg0ai/dx-reasongraph", "--scope", "project", "--yes"];
}

/** Install the repository-root ReasonGraph plugin into detected agent tools. */
export async function install(): Promise<number> {
  const runtime = resolveRuntime();
  if (!runtime) {
    warn("not inside a git repository. Run `git init` first, then `reasongraph install`.");
    return 1;
  }

  say("Installing ReasonGraph plugin with `npx plugins`...");
  const result = spawnSync("npx", pluginInstallArgs(), { cwd: runtime.repoRoot, stdio: "inherit" });
  if (result.error) {
    warn(`could not start npx plugins: ${result.error.message}`);
    return 1;
  }
  if (result.status !== 0) {
    warn(`npx plugins failed with exit code ${result.status ?? 1}.`);
    return result.status ?? 1;
  }

  say("ReasonGraph plugin installed.");
  return 0;
}
