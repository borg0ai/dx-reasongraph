import { test } from "vitest";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { loadConfig } from "../src/util/config.js";
import { init } from "../src/commands/init.js";
import { sync } from "../src/commands/sync.js";
import { uninstall } from "../src/commands/uninstall.js";
import { status } from "../src/commands/status.js";
import { doctor } from "../src/commands/doctor.js";

function git(cwd: string, args: string[]): string {
  return (spawnSync("git", args, { cwd, encoding: "utf8" }).stdout ?? "").trim();
}

/** Fresh repo with one commit. Returns dir; caller chdir's as needed. */
function tempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reasongraph-so-"));
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "t@t.co"]);
  git(dir, ["config", "user.name", "t"]);
  fs.writeFileSync(path.join(dir, "README.md"), "# repo\n");
  git(dir, ["add", "README.md"]);
  git(dir, ["commit", "-qm", "init"]);
  return dir;
}

function read(dir: string, rel: string): string {
  try {
    return fs.readFileSync(path.join(dir, rel), "utf8");
  } catch {
    return "";
  }
}

/** Run `fn` with cwd set to `dir` and stdout/stderr captured. */
async function inRepo<T>(dir: string, fn: () => T | Promise<T>): Promise<{ out: string; err: string; result: T }> {
  const cwd = process.cwd();
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  let out = "";
  let err = "";
  (process.stdout as any).write = (s: string) => ((out += s), true);
  (process.stderr as any).write = (s: string) => ((err += s), true);
  process.chdir(dir);
  try {
    const result = await fn();
    return { out, err, result };
  } finally {
    process.chdir(cwd);
    (process.stdout as any).write = origOut;
    (process.stderr as any).write = origErr;
  }
}

test("loadConfig: selfOnly forces effective sync to manual even when shared says auto", () => {
  const dir = tempRepo();
  fs.mkdirSync(path.join(dir, ".reasongraph", "state"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".reasongraph", "config.json"), JSON.stringify({ sync: "auto" }));
  fs.writeFileSync(path.join(dir, ".reasongraph", "state", "config.json"), JSON.stringify({ selfOnly: true }));

  const cfg = loadConfig(dir);
  assert.equal(cfg.selfOnly, true);
  assert.equal(cfg.sync, "manual");
});

test("loadConfig: without selfOnly, configured sync is honored", () => {
  const dir = tempRepo();
  fs.mkdirSync(path.join(dir, ".reasongraph"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".reasongraph", "config.json"), JSON.stringify({ sync: "auto" }));
  const cfg = loadConfig(dir);
  assert.equal(cfg.selfOnly, false);
  assert.equal(cfg.sync, "auto");
});

test("init --self-only: excludes artifacts privately and touches no shared file", async () => {
  const dir = tempRepo();
  await inRepo(dir, () => init({ selfOnly: true }));

  const excl = read(dir, ".git/info/exclude");
  assert.ok(excl.includes(".reasongraph/why/"), "exclude ignores personal why-packs");
  assert.ok(excl.includes(".reasongraph/state/"), "exclude ignores local state");

  // Nothing reasongraph wrote shows up as committable in git status.
  assert.equal(git(dir, ["status", "--porcelain"]), "", "no reasongraph artifacts left visible to git");

  assert.ok(!fs.existsSync(path.join(dir, "AGENTS.md")), "self-only does not write shared agent instructions");

  // No shared/committable files created or modified.
  assert.ok(!fs.existsSync(path.join(dir, ".reasongraph", "config.json")), "no shared config");
  assert.ok(!read(dir, ".gitignore").includes(".reasongraph/state/"), "shared .gitignore untouched");

  // Mode persisted locally; plugin hooks are installed by `reasongraph install`.
  assert.equal(JSON.parse(read(dir, ".reasongraph/state/config.json")).selfOnly, true);
  assert.ok(!fs.existsSync(path.join(dir, ".claude", "settings.local.json")), "init leaves agent hooks to plugin");
});

test("init (normal): still writes the shared artifacts and no exclude block", async () => {
  const dir = tempRepo();
  await inRepo(dir, () => init());

  const shared = JSON.parse(read(dir, ".reasongraph/config.json"));
  assert.equal(shared.distiller.backend, "agent", "init defaults the distiller CLI to agent");
  assert.equal(shared.distiller.models.agent, "auto");
  assert.ok(read(dir, ".gitignore").includes(".reasongraph/state/"), "shared gitignore written");
  assert.ok(read(dir, "AGENTS.md").includes("reasongraph:begin"), "committed pointer written");
  assert.ok(!read(dir, ".git/info/exclude").includes("reasongraph self-only"), "no private exclude");
});

test("init moves legacy why-packs into .reasongraph/why", async () => {
  const dir = tempRepo();
  fs.mkdirSync(path.join(dir, ".ai", "why"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".ai", "why", "main.md"), "# legacy\n");

  await inRepo(dir, () => init());

  assert.equal(read(dir, ".reasongraph/why/main.md"), "# legacy\n");
  assert.ok(!fs.existsSync(path.join(dir, ".ai", "why", "main.md")), "shared pack moved");
});

test("self-only init copies legacy why-packs and leaves source untouched", async () => {
  const dir = tempRepo();
  fs.mkdirSync(path.join(dir, ".ai", "why"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".ai", "why", "main.md"), "# legacy\n");

  await inRepo(dir, () => init({ selfOnly: true }));

  assert.equal(read(dir, ".reasongraph/why/main.md"), "# legacy\n");
  assert.equal(read(dir, ".ai/why/main.md"), "# legacy\n");
});

test("init refuses legacy pack collisions without changing either file", async () => {
  const dir = tempRepo();
  fs.mkdirSync(path.join(dir, ".ai", "why"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".reasongraph", "why"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".ai", "why", "main.md"), "# legacy\n");
  fs.writeFileSync(path.join(dir, ".reasongraph", "why", "main.md"), "# current\n");

  const { err, result } = await inRepo(dir, () => init());

  assert.equal(result, 1);
  assert.match(err, /destination already has main\.md/);
  assert.equal(read(dir, ".ai/why/main.md"), "# legacy\n");
  assert.equal(read(dir, ".reasongraph/why/main.md"), "# current\n");
});

test("init --self-only: warns when .reasongraph/why is already tracked but still proceeds", async () => {
  const dir = tempRepo();
  fs.mkdirSync(path.join(dir, ".reasongraph", "why"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".reasongraph", "why", "old.md"), "# tracked\n");
  git(dir, ["add", ".reasongraph/why/old.md"]);
  git(dir, ["commit", "-qm", "add why"]);

  const { err } = await inRepo(dir, () => init({ selfOnly: true }));
  assert.match(err, /track/i, "warns about already-tracked files");
  assert.ok(read(dir, ".git/info/exclude").includes(".reasongraph/why/"), "still writes the exclude");
});

test("init --self-only is idempotent on re-run (no duplicate exclude block)", async () => {
  const dir = tempRepo();
  await inRepo(dir, () => init({ selfOnly: true }));
  await inRepo(dir, () => init({ selfOnly: true }));
  const excl = read(dir, ".git/info/exclude");
  assert.equal(excl.split(">>> reasongraph self-only >>>").length - 1, 1, "exactly one block");
  assert.equal(JSON.parse(read(dir, ".reasongraph/state/config.json")).selfOnly, true);
});

test("sync under self-only: distills but never commits", async () => {
  const dir = tempRepo();
  fs.mkdirSync(path.join(dir, ".reasongraph", "state"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".reasongraph", "state", "config.json"), JSON.stringify({ selfOnly: true }));
  fs.mkdirSync(path.join(dir, ".reasongraph", "why"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".reasongraph", "why", "main.md"), "# why\n");

  const head0 = git(dir, ["rev-parse", "HEAD"]);
  const { out } = await inRepo(dir, () => sync());
  const head1 = git(dir, ["rev-parse", "HEAD"]);

  assert.equal(head1, head0, "no commit created");
  assert.match(out, /self-only/i);
});

test("uninstall removes the private exclude and pointer blocks", async () => {
  const dir = tempRepo();
  await inRepo(dir, () => init({ selfOnly: true }));
  await inRepo(dir, () => uninstall());

  assert.ok(!read(dir, ".git/info/exclude").includes("reasongraph self-only"), "exclude block gone");
  assert.ok(!fs.existsSync(path.join(dir, "AGENTS.md")), "no shared pointer created");
});

test("status under self-only reports the mode, not commit/push nags", async () => {
  const dir = tempRepo();
  await inRepo(dir, () => init({ selfOnly: true }));
  const { out } = await inRepo(dir, () => status());
  assert.match(out, /self-only/i);
  assert.ok(!/uncommitted change/i.test(out), "no uncommitted nag in self-only");
});

test("status under self-only warns instead of reassuring when why-packs are already tracked", async () => {
  const dir = tempRepo();
  fs.mkdirSync(path.join(dir, ".reasongraph", "why"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".reasongraph", "why", "old.md"), "# tracked\n");
  git(dir, ["add", ".reasongraph/why/old.md"]);
  git(dir, ["commit", "-qm", "add why"]);

  await inRepo(dir, () => init({ selfOnly: true }));
  const { out } = await inRepo(dir, () => status());
  assert.match(out, /already.*git-tracked/i, "warns that the guarantee is broken");
  assert.ok(!/not committed or shared/i.test(out), "does not print the safe green line");
});

test("doctor under self-only reports OK when nothing is tracked", async () => {
  const dir = tempRepo();
  await inRepo(dir, () => init({ selfOnly: true }));
  const { out, result } = await inRepo(dir, () => doctor());
  assert.match(out, /self-only mode — why-packs are personal/i);
  assert.equal(result, 0);
});

test("doctor under self-only flags a problem when why-packs are already tracked", async () => {
  const dir = tempRepo();
  fs.mkdirSync(path.join(dir, ".reasongraph", "why"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".reasongraph", "why", "old.md"), "# tracked\n");
  git(dir, ["add", ".reasongraph/why/old.md"]);
  git(dir, ["commit", "-qm", "add why"]);

  await inRepo(dir, () => init({ selfOnly: true }));
  const { out, result } = await inRepo(dir, () => doctor());
  assert.match(out, /already git-tracked/i, "flags the broken guarantee");
  assert.notEqual(result, 0, "reports a problem, not a clean bill of health");
});
