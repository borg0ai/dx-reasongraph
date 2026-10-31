import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import * as path from "node:path";
import { resolveRuntime } from "../util/runtime.js";
import { say, warn } from "../util/log.js";
import {
  detectGlobalSkillAgents,
  detectProjectSkillAgents,
  type GlobalAgentPaths,
  type SkillAgent,
} from "./skillAgents.js";

type InstallResult = { status: number | null; error?: Error };

export interface InstallOptions {
  global?: boolean;
  cwd?: string;
  homeDir?: string;
  configHome?: string;
  run?: (command: string, args: string[], cwd: string) => InstallResult;
}

function run(command: string, args: string[], cwd: string): InstallResult {
  return spawnSync(command, args, { cwd, stdio: "inherit" });
}

function installSkill(
  agents: readonly (SkillAgent | "universal")[],
  global: boolean,
  cwd: string,
  runCommand: NonNullable<InstallOptions["run"]>,
): number {
  say("Installing ReasonGraph skill with `skills`...");
  const result = runCommand("npx", skillInstallArgs(agents, global), cwd);
  if (result.error) {
    warn(`could not start skills CLI: ${result.error.message}`);
    return 1;
  }
  if (result.status !== 0) {
    warn(`npx skills failed with exit code ${result.status ?? 1}.`);
    return result.status ?? 1;
  }
  return 0;
}

/** Arguments for adding this repository's plugin through @borg0ai/plugins CLI. */
export function pluginInstallArgs(): string[] {
  return ["--yes", "@borg0ai/plugins", "add", "borg0ai/dx-reasongraph", "--scope", "project", "--yes"];
}

export function skillInstallArgs(agents: readonly (SkillAgent | "universal")[], global: boolean): string[] {
  if (global && agents.length === 0) throw new Error("global skill install requires a detected agent");
  const targets = agents.length > 0 ? agents : ["universal"];
  return [
    "--yes",
    "skills@1.5.13",
    "add",
    "borg0ai/dx-reasongraph",
    "--skill",
    "reasongraph",
    ...targets.flatMap((agent) => ["--agent", agent]),
    ...(global ? ["-g"] : []),
    "-y",
  ];
}

/** Install the skill for detected agents and the plugin at project scope. */
export async function install(options: InstallOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? homedir();
  const runCommand = options.run ?? run;

  if (options.global) {
    const configHome =
      options.configHome?.trim() ||
      process.env.XDG_CONFIG_HOME?.trim() ||
      path.join(homeDir, ".config");
    const agents = detectGlobalSkillAgents(
      homeDir,
      configHome,
      {
        claudeConfigDir: process.env.CLAUDE_CONFIG_DIR,
        codexHome: process.env.CODEX_HOME,
      } satisfies GlobalAgentPaths,
    );
    if (agents.length === 0) {
      warn("no supported agent detected in the global configuration. Nothing was installed.");
      return 1;
    }
    const result = installSkill(agents, true, cwd, runCommand);
    if (result !== 0) return result;
    say("ReasonGraph skill installed globally.");
    return 0;
  }

  const runtime = resolveRuntime(cwd);
  if (!runtime) {
    warn("not inside a git repository. Run `git init` first, then `reasongraph install`.");
    return 1;
  }

  const agents = detectProjectSkillAgents(runtime.repoRoot);
  const skillResult = installSkill(agents, false, runtime.repoRoot, runCommand);
  if (skillResult !== 0) return skillResult;

  say("Installing ReasonGraph plugin with `@borg0ai/plugins`...");
  const result = runCommand("npx", pluginInstallArgs(), runtime.repoRoot);
  if (result.error) {
    warn(`could not start @borg0ai/plugins: ${result.error.message}`);
    return 1;
  }
  if (result.status !== 0) {
    warn(`npx @borg0ai/plugins failed with exit code ${result.status ?? 1}.`);
    return result.status ?? 1;
  }

  say("ReasonGraph plugin installed.");
  return 0;
}
