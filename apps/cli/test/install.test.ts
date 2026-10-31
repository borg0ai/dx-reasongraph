import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, test } from "vitest";
import {
  install,
  pluginInstallArgs,
  skillInstallArgs,
} from "../src/commands/install.js";
import {
  detectGlobalSkillAgents,
  detectProjectSkillAgents,
} from "../src/commands/skillAgents.js";

const temporaryDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "reasongraph-install-test-"),
  );
  temporaryDirs.push(dir);
  return dir;
}

function touch(root: string, marker: string): void {
  const target = path.join(root, marker);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "");
}

afterEach(() => {
  for (const dir of temporaryDirs.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});

test("agent detectors return supported project and global targets in registry order", () => {
  const repo = makeTempDir();
  const home = makeTempDir();
  const configHome = path.join(makeTempDir(), "xdg");
  for (const marker of [
    ".gemini/antigravity/config.json",
    ".claude/settings.json",
    ".codex/config.toml",
    ".cursor/rules",
    ".cursorrules",
    "opencode.jsonc",
  ]) {
    touch(repo, marker);
  }
  for (const marker of [
    ".gemini/antigravity/config.json",
    ".claude/settings.json",
    ".codex/config.toml",
    ".cursor/extensions",
    "unused",
  ]) {
    touch(home, marker);
  }
  touch(configHome, "opencode/config.json");

  assert.deepEqual(detectProjectSkillAgents(repo), [
    "antigravity",
    "claude-code",
    "codex",
    "cursor",
    "opencode",
  ]);
  assert.deepEqual(detectGlobalSkillAgents(home, configHome), [
    "antigravity",
    "claude-code",
    "codex",
    "cursor",
    "opencode",
  ]);
});

test("global detection honors custom Claude and Codex configuration directories", () => {
  const home = makeTempDir();
  const customClaude = path.join(makeTempDir(), "claude-config");
  const customCodex = path.join(makeTempDir(), "codex-home");
  touch(customClaude, "settings.json");
  touch(customCodex, "config.toml");

  assert.deepEqual(
    detectGlobalSkillAgents(home, path.join(home, ".config"), {
      claudeConfigDir: customClaude,
      codexHome: customCodex,
    }),
    ["claude-code", "codex"],
  );
});

test("project install targets universal only when no supported project agent is detected", async () => {
  const repo = makeTempDir();
  execFileSync("git", ["init", "-q"], { cwd: repo });
  const repoRoot = fs.realpathSync(repo);
  const calls: { command: string; args: string[]; cwd: string }[] = [];
  const result = await install({
    cwd: repo,
    run: (command, args, cwd) => {
      calls.push({ command, args, cwd });
      return { status: 0 };
    },
  });

  assert.equal(result, 0);
  assert.deepEqual(calls, [
    {
      command: "npx",
      args: skillInstallArgs(["universal"], false),
      cwd: repoRoot,
    },
    { command: "npx", args: pluginInstallArgs(), cwd: repoRoot },
  ]);
  assert.deepEqual(skillInstallArgs(["universal"], false), [
    "--yes",
    "skills@1.5.13",
    "add",
    "borg0ai/dx-reasongraph",
    "--skill",
    "reasongraph",
    "--agent",
    "universal",
    "-y",
  ]);
});

test("project install passes only detected targets and then installs project plugin", async () => {
  const repo = makeTempDir();
  execFileSync("git", ["init", "-q"], { cwd: repo });
  const repoRoot = fs.realpathSync(repo);
  touch(repo, ".claude/settings.json");
  touch(repo, ".cursor/rules");
  const calls: { args: string[]; cwd: string }[] = [];
  const result = await install({
    cwd: repo,
    run: (_command, args, commandCwd) => {
      calls.push({ args, cwd: commandCwd });
      return { status: 0 };
    },
  });

  assert.equal(result, 0);
  assert.deepEqual(calls, [
    { args: skillInstallArgs(["claude-code", "cursor"], false), cwd: repoRoot },
    { args: pluginInstallArgs(), cwd: repoRoot },
  ]);
});

test("global install fails before invoking installers when no global agent is detected", async () => {
  const cwd = makeTempDir();
  const home = makeTempDir();
  const previousClaudeDir = process.env.CLAUDE_CONFIG_DIR;
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CLAUDE_CONFIG_DIR = path.join(home, "missing-claude");
  process.env.CODEX_HOME = path.join(home, "missing-codex");
  let invoked = false;
  let result: number;
  try {
    result = await install({
      global: true,
      cwd,
      homeDir: home,
      configHome: path.join(home, "config"),
      run: () => {
        invoked = true;
        return { status: 0 };
      },
    });
  } finally {
    if (previousClaudeDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previousClaudeDir;
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
  }

  assert.equal(result, 1);
  assert.equal(invoked, false);
});

test("global install passes agents from custom configuration directories", async () => {
  const cwd = makeTempDir();
  const home = makeTempDir();
  const customClaude = path.join(makeTempDir(), "claude-config");
  const customCodex = path.join(makeTempDir(), "codex-home");
  touch(customClaude, "settings.json");
  touch(customCodex, "config.toml");
  const previousClaudeDir = process.env.CLAUDE_CONFIG_DIR;
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CLAUDE_CONFIG_DIR = customClaude;
  process.env.CODEX_HOME = customCodex;
  const calls: string[][] = [];
  let result: number;
  try {
    result = await install({
      global: true,
      cwd,
      homeDir: home,
      configHome: path.join(home, ".config"),
      run: (_command, args) => {
        calls.push(args);
        return { status: 0 };
      },
    });
  } finally {
    if (previousClaudeDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previousClaudeDir;
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
  }

  assert.equal(result, 0);
  assert.deepEqual(calls, [skillInstallArgs(["claude-code", "codex"], true)]);
});

test("global install works outside a repository and skips plugin installation", async () => {
  const cwd = makeTempDir();
  const home = makeTempDir();
  touch(home, ".codex/config.toml");
  const calls: { args: string[]; cwd: string }[] = [];
  const result = await install({
    global: true,
    cwd,
    homeDir: home,
    run: (_command, args, commandCwd) => {
      calls.push({ args, cwd: commandCwd });
      return { status: 0 };
    },
  });

  assert.equal(result, 0);
  assert.deepEqual(calls, [{ args: skillInstallArgs(["codex"], true), cwd }]);
});
