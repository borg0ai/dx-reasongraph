import { test } from "vitest";
import assert from "node:assert/strict";
import { agentArgs, codexArgs, modelForCli, selectBackend } from "../src/distiller/backends.js";
import { DEFAULT_CONFIG, reasongraphConfig } from "../src/util/config.js";

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
  assert.equal(codex.at(-1), "-");
});

test("a CLI with no model is rejected", () => {
  const broken = cfg("agent", "  ");
  assert.throws(() => modelForCli(broken), /distiller\.models\.agent is required/);
});
