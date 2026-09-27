import * as fs from "node:fs";
import { reasongraphPaths } from "./paths.js";

export type DistillerBackend = "claude" | "agent" | "codex";

/** Model id for each distiller CLI. The active backend reads only its own entry. */
export interface CliModels {
  claude: string;
  agent: string;
  codex: string;
}

export interface reasongraphConfig {
  /** Distiller CLI and the model bound to each CLI. */
  distiller: {
    backend: DistillerBackend;
    models: CliModels;
    /**
     * How many transcript chunks to distill concurrently. A big session is many
     * chunks, and one-at-a-time is what made the pre-push sweep blow its budget.
     * Kept low by default: each backend spawns a CLI per call, so 3 stays inside
     * the budget without thrashing.
     */
    concurrency: number;
  };
  /** Extra redaction regexes (source strings, applied case-insensitively). */
  redaction: string[];
  /** Hard wall-clock budget for the pre-push sweep, in milliseconds. */
  timeBudgetMs: number;
  /** Max characters of prepared transcript per LLM chunk. */
  chunkChars: number;
  /**
   * Debounced background distillation on the Stop hook, so the why-pack stays
   * current as you work — no push, no manual ask. Still post-hoc distillation
   * of the complete-so-far transcript (not in-flight logging); pre-push and
   * SessionEnd remain the backstops, so this errs quiet.
   */
  autoDistill: {
    enabled: boolean;
    /** Minimum time between background distills of a session. */
    minIntervalMs: number;
    /** Minimum new transcript bytes since last distill before firing. */
    minGrowthBytes: number;
  };
  /**
   * How the why-pack reaches git.
   * - "auto" (default): commit `.reasongraph/why/` — never push — at settle points
   *   (session end and the pre-push sweep), built via a scratch index that never
   *   touches your staging area, so it rides your next push and GitHub stops
   *   silently lagging. A local commit isn't sharing; push stays the human gate.
   * - "manual": never commit; `status`/`doctor`/pre-push just report staleness
   *   loudly and you run `reasongraph sync`. For shops where a tool authoring
   *   commits is a hard no (commit-signing, CI conventions).
   */
  sync: "auto" | "manual";
  /**
   * Personal mode (set by `reasongraph init --self-only`, stored local-only). The
   * why-packs become private notes: nothing is committed and the artifacts are
   * ignored via `.git/info/exclude` rather than the shared `.gitignore`. When
   * true, effective `sync` is forced to "manual" so no code path commits.
   */
  selfOnly: boolean;
}

export const DEFAULT_CONFIG: reasongraphConfig = {
  distiller: {
    backend: "claude",
    models: {
      claude: "haiku",
      agent: "auto",
      codex: "gpt-6-luna",
    },
    concurrency: 3,
  },
  redaction: [],
  timeBudgetMs: 60_000,
  chunkChars: 100_000,
  autoDistill: {
    enabled: true,
    minIntervalMs: 180_000, // 3 min
    minGrowthBytes: 15_360, // 15 KB
  },
  sync: "auto",
  selfOnly: false,
};

/** Old configs stored one `model` string. That string belongs to the claude CLI. */
function normalizeDistiller(raw: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!raw || typeof raw.distiller !== "object" || raw.distiller === null || Array.isArray(raw.distiller)) {
    return raw;
  }
  const distiller = { ...(raw.distiller as Record<string, unknown>) };
  const legacy = distiller.model;
  delete distiller.model;
  if (typeof legacy === "string" && legacy.trim()) {
    const models =
      typeof distiller.models === "object" && distiller.models !== null && !Array.isArray(distiller.models)
        ? { ...(distiller.models as Record<string, unknown>) }
        : {};
    if (typeof models.claude !== "string" || !models.claude.trim()) models.claude = legacy.trim();
    distiller.models = models;
  }
  return { ...raw, distiller };
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function deepMerge<T>(base: T, override: Record<string, unknown> | null): T {
  if (!override) return base;
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v === null || v === undefined) continue;
    if (
      typeof v === "object" &&
      !Array.isArray(v) &&
      typeof out[k] === "object" &&
      out[k] !== null &&
      !Array.isArray(out[k])
    ) {
      out[k] = deepMerge(out[k], v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Effective config = defaults <- committed .reasongraph/config.json <- local
 * .reasongraph/state/config.json (machine-specific overrides).
 */
export function loadConfig(repoRoot: string): reasongraphConfig {
  const paths = reasongraphPaths(repoRoot);
  let cfg = DEFAULT_CONFIG;
  cfg = deepMerge(cfg, normalizeDistiller(readJson(paths.sharedConfigFile)));
  cfg = deepMerge(cfg, normalizeDistiller(readJson(paths.localConfigFile)));
  // Self-only is a personal "never commit" mode: force sync to manual so no
  // settle-point or explicit commit path can fire, whatever the shared config says.
  if (cfg.selfOnly) cfg = { ...cfg, sync: "manual" };
  return cfg;
}

/** The team-shared config written by `init` (committed). */
export function defaultSharedConfig(): Record<string, unknown> {
  return {
    distiller: {
      backend: DEFAULT_CONFIG.distiller.backend,
      models: DEFAULT_CONFIG.distiller.models,
    },
    redaction: [],
    timeBudgetMs: DEFAULT_CONFIG.timeBudgetMs,
    sync: DEFAULT_CONFIG.sync,
  };
}

export function isDisabled(paths: reasongraphPaths): boolean {
  return fs.existsSync(paths.disabledFlag);
}
