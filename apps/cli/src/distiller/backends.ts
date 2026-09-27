import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { reasongraphConfig } from "../util/config.js";

/**
 * The distiller's own `claude -p` subprocess must NOT run inside the repo:
 * otherwise its transcript lands in the repo's Claude projects dir and gets
 * re-ingested, and its session end fires the repo's reasongraph hooks — an
 * infinite distill→claude→SessionEnd→distill loop. We run it in an isolated
 * throwaway cwd and set REASONGRAPH_DISTILLING so any inherited hook no-ops.
 */
const DISTILLER_CWD = path.join(os.tmpdir(), "reasongraph-distiller");
export const DISTILLING_ENV = "REASONGRAPH_DISTILLING";

const CLI_CLAUDE = "claude";
const CLI_AGENT = "agent";
const CLI_CODEX = "codex";
const OUTPUT_FORMAT_TEXT = "text";
const AGENT_MODE_ASK = "ask";
const CODEX_SANDBOX_READ_ONLY = "read-only";

/**
 * Env for a distiller subprocess. `process.env` must be reached through this
 * split property: the CLI bundler replaces a literal `process.env` with `{}`,
 * the child loses PATH, and every chunk dies with `spawn ENOENT`.
 */
function distillerChildEnv(): NodeJS.ProcessEnv {
  const proc = (globalThis as any)["pro" + "cess"];
  const childEnv: NodeJS.ProcessEnv = { ...proc.env };
  childEnv[DISTILLING_ENV] = "1";
  return childEnv;
}

function runIsolatedCli(
  command: string,
  args: string[],
  stdin: string,
  timeoutMs: number,
  label: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      fs.mkdirSync(DISTILLER_CWD, { recursive: true });
    } catch {
      /* fall back to inherited cwd */
    }
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: DISTILLER_CWD,
      env: distillerChildEnv(),
    });
    let out = "";
    let err = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`failed to spawn ${command}: ${e.message}`));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else {
        const detail = (err.trim() || out.trim()).slice(0, 500);
        reject(new Error(`${label} exited ${code}: ${detail}`));
      }
    });

    child.stdin.write(stdin);
    child.stdin.end();
  });
}

export interface LLMBackend {
  readonly name: string;
  /** Returns the model's raw text response. Throws on failure/timeout. */
  complete(system: string, user: string, timeoutMs: number): Promise<string>;
}

/** The model configured for the CLI that will actually run. */
export function modelForCli(cfg: reasongraphConfig): string {
  const model = cfg.distiller.models?.[cfg.distiller.backend];
  if (typeof model !== "string" || !model.trim()) {
    throw new Error(`distiller.models.${cfg.distiller.backend} is required when backend is ${cfg.distiller.backend}`);
  }
  return model;
}

export function agentArgs(model: string): string[] {
  return [
    "-p",
    "--mode",
    AGENT_MODE_ASK,
    "--output-format",
    OUTPUT_FORMAT_TEXT,
    "--trust",
    "--sandbox",
    "enabled",
    "--workspace",
    DISTILLER_CWD,
    "--model",
    model,
  ];
}

export function codexArgs(model: string, lastMessagePath: string): string[] {
  return [
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "-s",
    CODEX_SANDBOX_READ_ONLY,
    "-C",
    DISTILLER_CWD,
    "--color",
    "never",
    "-o",
    lastMessagePath,
    "-m",
    model,
    "-",
  ];
}

/** Headless Claude Code. The model is `distiller.models.claude`. */
export class ClaudePBackend implements LLMBackend {
  readonly name = CLI_CLAUDE;
  constructor(private model: string) {}

  complete(system: string, user: string, timeoutMs: number): Promise<string> {
    const args = ["-p", "--model", this.model, "--output-format", OUTPUT_FORMAT_TEXT, "--system-prompt", system];
    return runIsolatedCli(CLI_CLAUDE, args, user, timeoutMs, "claude -p");
  }
}

/**
 * Cursor's `agent` CLI. `--mode ask` is read-only. The model is
 * `distiller.models.agent`. Auth stays inside the CLI.
 */
export class AgentCliBackend implements LLMBackend {
  readonly name = CLI_AGENT;
  constructor(private model: string) {}

  complete(system: string, user: string, timeoutMs: number): Promise<string> {
    return runIsolatedCli(CLI_AGENT, agentArgs(this.model), `${system}\n\n${user}`, timeoutMs, CLI_AGENT);
  }
}

/**
 * `codex exec` in a read-only sandbox. The model is `distiller.models.codex`.
 * The final message is the `-o` file. Auth stays inside the CLI.
 */
export class CodexCliBackend implements LLMBackend {
  readonly name = CLI_CODEX;
  constructor(private model: string) {}

  async complete(system: string, user: string, timeoutMs: number): Promise<string> {
    fs.mkdirSync(DISTILLER_CWD, { recursive: true });
    const lastMessage = path.join(DISTILLER_CWD, `codex-last-${randomBytes(8).toString("hex")}.txt`);
    try {
      const stdout = await runIsolatedCli(
        CLI_CODEX,
        codexArgs(this.model, lastMessage),
        `${system}\n\n${user}`,
        timeoutMs,
        CLI_CODEX,
      );
      const saved = fs.existsSync(lastMessage) ? fs.readFileSync(lastMessage, "utf8") : "";
      return saved.trim() ? saved : stdout;
    } finally {
      fs.rmSync(lastMessage, { force: true });
    }
  }
}

export function selectBackend(cfg: reasongraphConfig): LLMBackend {
  const model = modelForCli(cfg);
  if (cfg.distiller.backend === CLI_AGENT) return new AgentCliBackend(model);
  if (cfg.distiller.backend === CLI_CODEX) return new CodexCliBackend(model);
  if (cfg.distiller.backend === CLI_CLAUDE) return new ClaudePBackend(model);
  throw new Error(`distiller.backend '${cfg.distiller.backend}' is not a CLI. Use ${CLI_CLAUDE}, ${CLI_AGENT}, or ${CLI_CODEX}.`);
}

/** Extract the first top-level JSON object from a possibly-noisy response. */
export function extractJson(text: string): any {
  // Prefer a fenced ```json block if present.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates: string[] = [];
  if (fence) candidates.push(fence[1]);
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));
  candidates.push(text);
  for (const c of candidates) {
    try {
      return JSON.parse(c.trim());
    } catch {
      // try next candidate
    }
  }
  throw new Error("no parseable JSON in model response");
}
