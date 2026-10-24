import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import { pluginInstallArgs } from "../src/commands/install.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const pluginRoot = path.join(repoRoot, "reasongraph");

test("install uses @borg0ai/plugins against the repository source at project scope", () => {
  assert.deepEqual(pluginInstallArgs(), [
    "--yes", "@borg0ai/plugins", "add", "borg0ai/dx-reasongraph", "--scope", "project", "--yes",
  ]);
});

test("install does not locate @borg0ai/plugins through the filesystem", () => {
  const src = fs.readFileSync(path.join(repoRoot, "apps", "cli", "src", "commands", "install.ts"), "utf8");
  assert.doesNotMatch(src, /LOCAL_PLUGINS_CLI|__dirname|plugins\/dist/);
});

test("root plugin exposes hooks and a skill that closes the CLI context and sync loop", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, ".plugin", "plugin.json"), "utf8"));
  const hooks = JSON.parse(fs.readFileSync(path.join(pluginRoot, "hooks", "hooks.json"), "utf8"));
  const skill = fs.readFileSync(path.join(pluginRoot, "skills", "reasongraph", "SKILL.md"), "utf8");

  assert.equal(manifest.name, "reasongraph");
  assert.ok(Object.keys(hooks.hooks).length > 0);
  assert.match(skill, /npx --yes @borg0ai\/reasongraph context/);
  assert.match(skill, /npx --yes @borg0ai\/reasongraph sync/);
  assert.equal(fs.existsSync(path.join(repoRoot, "apps", "cli", "reasongraph")), false);
});
