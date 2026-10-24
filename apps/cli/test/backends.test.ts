import { test } from "vitest";
import assert from "node:assert/strict";
import { agentArgs, antigravityArgs, codexArgs, modelForCli, selectBackend, FailoverBackend } from "../src/distiller/backends.js";
import { DEFAULT_CONFIG, defaultSharedConfig, reasongraphConfig } from "../src/util/config.js";

function cfg(backend: reasongraphConfig["distiller"]["backend"], model: string): reasongraphConfig {
  return {
    ...DEFAULT_CONFIG,
    distiller: {
      ...DEFAULT_CONFIG.distiller,
      backend,
      models: { ...DEFAULT_CONFIG.distiller.models, [backend]: model },
    },
  };
}

test("init's shared config defaults the distiller to codex", () => {
  assert.equal(DEFAULT_CONFIG.distiller.backend, "codex");
  const shared = defaultSharedConfig() as { distiller: { backend: string; models: { codex: string } } };
  assert.equal(shared.distiller.backend, "codex");
  assert.equal(shared.distiller.models.codex, "gpt-6-luna");
});

test("the active CLI uses only its own model", () => {
  const agent = cfg("agent", "composer-2.5");
  assert.equal(modelForCli(agent), "composer-2.5");
  assert.equal(selectBackend(agent).name, "agent");

  const codex = cfg("codex", "gpt-6-luna");
  assert.equal(modelForCli(codex), "gpt-6-luna");
  assert.equal(selectBackend(codex).name, "codex");

  assert.equal(modelForCli(cfg("claude", "haiku")), "haiku");
  assert.equal(selectBackend(cfg("claude", "haiku")).name, "claude");
});

test("agent and codex always receive the model configured for that CLI", () => {
  const agent = agentArgs("auto");
  assert.equal(agent[agent.indexOf("--mode") + 1], "ask");
  assert.equal(agent[agent.indexOf("--model") + 1], "auto");

  const codex = codexArgs("gpt-6-luna", "/tmp/last.txt");
  assert.equal(codex[codex.indexOf("-s") + 1], "read-only");
  assert.equal(codex[codex.indexOf("-m") + 1], "gpt-6-luna");
  assert.equal(codex[codex.indexOf("-c") + 1], 'model_reasoning_effort="medium"');
  assert.equal(codex.at(-1), "-");
});

test("a CLI with no model is rejected", () => {
  const broken = cfg("agent", "  ");
  assert.throws(() => modelForCli(broken), /distiller\.models\.agent is required/);
});

test("failover backend falls through to the next backend and reports the primary name", async () => {
  const failing = { name: "agent", complete: async () => { throw new Error("quota"); } };
  const working = { name: "claude", complete: async () => "ok" };
  const b = new FailoverBackend([failing, working]);
  assert.equal(b.name, "agent");
  assert.equal(await b.complete("s", "u", 1000), "ok");
  await assert.rejects(new FailoverBackend([failing, failing]).complete("s", "u", 1000), /quota/);
});

test("antigravity attaches the prompt to -p and selects its own model", () => {
  const args = antigravityArgs("gemini-3.8-flash-medium", "hello");
  assert.equal(args.at(-1), "-p=hello");
  assert.equal(args[args.indexOf("--model") + 1], "gemini-3.8-flash-medium");
  assert.ok(args.includes("--sandbox"));
});
