import { test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The distiller spawns `claude -p` as a child process. That only works if the
 * child inherits a real environment (above all PATH, so `claude` resolves).
 *
 * The CLI ships as a minified bundle, and the bundler statically substitutes a
 * literal `process.env` with `{}`. When that happens the child is spawned with
 * an env containing only REASONGRAPH_DISTILLING — no PATH — so every chunk
 * fails with `spawn claude ENOENT` and a whole backfill silently produces an
 * empty why-pack. The bug is invisible in source review and in unit tests
 * (vitest doesn't bundle), so it is asserted here against the real artifact.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const distCli = path.resolve(here, "../dist/cli.js");

/** The env object the backend hands to `spawn`, recovered from the bundle. */
function spawnedEnvLiteral(bundle: string): string {
  const anchor = bundle.indexOf("reasongraph-distiller`");
  assert.notEqual(anchor, -1, "bundle should contain the distiller cwd constant");
  const window = bundle.slice(anchor, anchor + 800);
  const m = window.match(/let \w+=\{[^;]{0,160}/);
  assert.ok(m, "could not locate the child env construction in the bundle");
  return m[0];
}

test("the built bundle preserves the real process.env for the distiller child", () => {
  // NOTE: deliberately NOT skipped when dist/ is absent. A silent skip here
  // reads as "guard passed" while asserting nothing — which is how a broken
  // distiller would ship green. CI builds before testing, so require it.
  assert.ok(
    existsSync(distCli),
    `built CLI not found at ${distCli} — run \`pnpm build\` before the tests ` +
      `(this guard must never silently no-op)`,
  );
  const bundle = readFileSync(distCli, "utf8");
  const literal = spawnedEnvLiteral(bundle);

  assert.ok(
    !/\{\s*\}/.test(literal),
    `bundler emptied the child env (${literal}) — the distiller subprocess would ` +
      `inherit no PATH and fail with "spawn claude ENOENT". Reference process.env ` +
      `through an indirection the bundler cannot statically match.`,
  );

  // The env source may be minified to any identifier (`{...jt()}`), so assert
  // structurally: the literal must spread a call/property, not be an empty
  // object. This keeps the test about the invariant, not today's codegen.
  const spread = literal.match(/\{\s*\.\.\.([^}]*)\}/);
  assert.ok(
    spread && spread[1].trim().length > 0,
    `child env is not spreading a live env source (${literal})`,
  );
  assert.ok(
    !/\bprocess\.env\b\s*(?!\S)/.test(literal) || /\.\.\./.test(literal),
    `child env lost its env source: ${literal}`,
  );
});

test("child env indirection survives minification (bundler regression guard)", () => {
  // Guards the *technique*, not just today's artifact: assert that a build of
  // the same source with the same bundler keeps the spread. If a future
  // bundler starts normalizing the indirection, this fails before it ships.
  const dir = mkdtempSync(path.join(tmpdir(), "rg-env-guard-"));
  const entry = path.join(dir, "entry.ts");
  writeFileSync(
    entry,
    "const proc = (globalThis as any)['pro' + 'cess'];\n" +
      "export const env = { ...proc.env };\n",
  );

  const vite = path.resolve(here, "../node_modules/.bin/vite");
  const config = path.join(dir, "vite.config.ts");
  writeFileSync(
    config,
    `import { builtinModules } from "node:module";
import { defineConfig } from "vite";
const b = new Set(builtinModules.flatMap((n) => [n, \`node:\${n}\`]));
export default defineConfig({
  build: {
    target: "node20",
    outDir: "out",
    rolldownOptions: {
      input: ${JSON.stringify(entry)},
      external: (id: string) => b.has(id),
      output: { format: "es", entryFileNames: "out.js" },
    },
  },
});
`,
  );

  if (!existsSync(vite)) return; // deps not installed; skip rather than fail

  execFileSync(vite, ["build", "--config", config], { cwd: dir, stdio: "pipe" });
  const out = readFileSync(path.join(dir, "out/out.js"), "utf8");

  assert.ok(
    /\.env/.test(out) && !/let \w+=\{\}/.test(out),
    `bundler emptied the indirection (${out.trim()}) — the child env technique is no longer safe`,
  );
});
