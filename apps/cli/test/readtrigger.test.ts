import { test } from "vitest";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ensureAgentsMd } from "../src/commands/init.js";
import { collectContext } from "../src/commands/context.js";
import { reasongraphPaths } from "../src/util/paths.js";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "reasongraph-rt-"));
}

const SAMPLE_PACK = `# Why: main

## Intent
Do the thing.

## Decisions

### Cache the config loader
Status: agent-initiated
Touches: \`src/config.ts\`

Memoized because it was read on every request.

### Set the guest token expiry short
Status: directed
Touches: \`lib/auth/tokens.ts\`

Guest links are emailed and may leak.
`;

test("ensureAgentsMd creates the pointer and is idempotent", () => {
  const repo = tmp();
  assert.equal(ensureAgentsMd(repo), "created");
  const md = fs.readFileSync(path.join(repo, "AGENTS.md"), "utf8");
  assert.match(md, /reasongraph:begin/);
  assert.match(md, /\.ai\/why/);
  assert.match(md, /prefer it over commit messages/i);
  // Second call is a no-op — no duplicate block.
  assert.equal(ensureAgentsMd(repo), "already present");
  const md2 = fs.readFileSync(path.join(repo, "AGENTS.md"), "utf8");
  assert.equal(md2.match(/reasongraph:begin/g)?.length, 1);
  fs.rmSync(repo, { recursive: true, force: true });
});

test("ensureAgentsMd appends to an existing AGENTS.md without clobbering it", () => {
  const repo = tmp();
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "# My Project\n\nExisting guidance.\n");
  assert.equal(ensureAgentsMd(repo), "appended");
  const md = fs.readFileSync(path.join(repo, "AGENTS.md"), "utf8");
  assert.match(md, /# My Project/);
  assert.match(md, /Existing guidance\./);
  assert.match(md, /reasongraph:begin/);
  fs.rmSync(repo, { recursive: true, force: true });
});

test("collectContext returns entries whose Touches match a file, nothing for a non-match", () => {
  const repo = tmp();
  const paths = reasongraphPaths(repo);
  fs.mkdirSync(paths.whyDir, { recursive: true });
  fs.writeFileSync(path.join(paths.whyDir, "main.md"), SAMPLE_PACK);

  const hit = collectContext(paths, repo, "src/config.ts");
  assert.match(hit, /Cache the config loader/);
  assert.ok(!hit.includes("guest token"), "only the matching entry is returned");

  const miss = collectContext(paths, repo, "src/unrelated.ts");
  assert.equal(miss, "", "no matching entries → empty string");
  fs.rmSync(repo, { recursive: true, force: true });
});

test("collectContext de-duplicates the same decision across multiple branch packs", () => {
  const repo = tmp();
  const paths = reasongraphPaths(repo);
  fs.mkdirSync(paths.whyDir, { recursive: true });
  fs.writeFileSync(path.join(paths.whyDir, "main.md"), SAMPLE_PACK);
  fs.writeFileSync(path.join(paths.whyDir, "feature-x.md"), SAMPLE_PACK); // same entries

  const hit = collectContext(paths, repo, "src/config.ts");
  assert.equal(hit.match(/Cache the config loader/g)?.length, 1, "entry shown once, not per pack");
  fs.rmSync(repo, { recursive: true, force: true });
});
