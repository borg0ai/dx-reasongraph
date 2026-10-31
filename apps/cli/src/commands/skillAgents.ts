import * as fs from "node:fs";
import * as path from "node:path";

export type SkillAgent =
  "antigravity" | "claude-code" | "codex" | "cursor" | "opencode";

interface AgentMarkers {
  id: SkillAgent;
  project: string[];
  global: (
    homeDir: string,
    configHome: string,
    overrides: GlobalAgentPaths,
  ) => string[];
}

export interface GlobalAgentPaths {
  claudeConfigDir?: string;
  codexHome?: string;
}

const AGENTS: AgentMarkers[] = [
  {
    id: "antigravity",
    project: [".gemini/antigravity"],
    global: (home) => [path.join(home, ".gemini/antigravity")],
  },
  {
    id: "claude-code",
    project: [".claude"],
    global: (home, _config, overrides) => [
      overrides.claudeConfigDir?.trim() || path.join(home, ".claude"),
    ],
  },
  {
    id: "codex",
    project: [".codex"],
    global: (home, _config, overrides) => [
      overrides.codexHome?.trim() || path.join(home, ".codex"),
    ],
  },
  {
    id: "cursor",
    project: [".cursor", ".cursorrules"],
    global: (home) => [path.join(home, ".cursor")],
  },
  {
    id: "opencode",
    project: [".opencode", "opencode.json", "opencode.jsonc"],
    global: (home, configHome) => [
      path.join(home, ".opencode"),
      path.join(configHome, "opencode"),
    ],
  },
];

function detectedAgents(
  markers: (agent: AgentMarkers) => string[],
  root: string,
): SkillAgent[] {
  return AGENTS.filter((agent) =>
    markers(agent).some((marker) => fs.existsSync(path.join(root, marker))),
  ).map((agent) => agent.id);
}

export function detectProjectSkillAgents(repoRoot: string): SkillAgent[] {
  return detectedAgents((agent) => agent.project, repoRoot);
}

export function detectGlobalSkillAgents(
  homeDir: string,
  configHome = path.join(homeDir, ".config"),
  overrides: GlobalAgentPaths = {},
): SkillAgent[] {
  return AGENTS.filter((agent) =>
    agent
      .global(homeDir, configHome, overrides)
      .some((marker) => fs.existsSync(marker)),
  ).map((agent) => agent.id);
}
