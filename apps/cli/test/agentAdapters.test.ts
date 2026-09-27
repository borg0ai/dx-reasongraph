import { test } from "vitest";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { distillSession } from "../src/core/distillSession.js";
import { sessionsNeedingDistill } from "../src/core/sweep.js";
import { StateFile, SessionRecord } from "../src/state/state.js";
import { DEFAULT_CONFIG } from "../src/util/config.js";
import { reasongraphPaths } from "../src/util/paths.js";
import { fileSize } from "../src/util/fsx.js";
import { listWorktrees } from "../src/util/git.js";
import { ADAPTERS, STUBBED_ADAPTERS } from "../src/adapters/index.js";
import { CodexAdapter } from "../src/adapters/codex.js";
import { CursorAgentAdapter, cursorProjectSlug } from "../src/adapters/cursor-agent.js";
import { OpenCodeAdapter } from "../src/adapters/opencode.js";
import { TOOL_CLAUDE_CODE, TOOL_CODEX, TOOL_CURSOR_AGENT, TOOL_OPENCODE } from "../src/adapters/names.js";
import { CLERK_PACK, FIXTURES, MockBackend, readFixture } from "./helpers.js";

const CODEX_SESSION = "codex-fixture";
const CURSOR_SESSION = "cursor-fixture";
const OPENCODE_SESSION = "ses_opencode";
const OPENCODE_FIRST = "msg_first";
const OPENCODE_SECOND = "msg_second";
const TYPE_USER = "user";
const FIRST_RULE = "Keep the first guest token rule.";
const SECOND_RULE = "Add a second guest token rule.";
const INSERT_MESSAGE = `
  INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`;

function tempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reasongraph-adapter-"));
  spawnSync("git", ["init", "-q"], { cwd: dir });
  spawnSync("git", ["config", "user.email", "t@t.co"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "t"], { cwd: dir });
  fs.writeFileSync(path.join(dir, ".keep"), "");
  spawnSync("git", ["add", ".keep"], { cwd: dir });
  spawnSync("git", ["commit", "-qm", "init"], { cwd: dir });
  spawnSync("git", ["branch", "guest-access"], { cwd: dir });
  return dir;
}

function record(repo: string, tool: string, transcript: string): SessionRecord {
  return {
    tool,
    transcript_path: transcript,
    repo,
    branches_seen: [],
    files_touched: [],
    first_seen: "2026-09-01T00:00:00Z",
    last_seen: "2026-09-01T00:00:00Z",
    last_distilled_offset: 0,
    status: "dirty",
  };
}

function stateFor(repo: string, id: string, rec: SessionRecord): StateFile {
  return { version: 1, sessions: { [id]: rec } };
}

test("active adapters are the four tools and the stub list is empty", () => {
  assert.deepEqual(
    ADAPTERS.map((adapter) => adapter.tool),
    [TOOL_CLAUDE_CODE, TOOL_CODEX, TOOL_OPENCODE, TOOL_CURSOR_AGENT],
  );
  assert.equal(STUBBED_ADAPTERS.length, 0);
});

test("codex fixture distills into the why-pack and discovery matches cwd", async () => {
  const repo = tempRepo();
  const sessionsRoot = path.join(repo, "codex-sessions");
  const file = path.join(sessionsRoot, "2026", "09", "01", "rollout.jsonl");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, readFixture("codex-session.jsonl").replace('"/repo"', JSON.stringify(repo)));

  const adapter = new CodexAdapter(sessionsRoot);
  const found = adapter.discoverSessions(repo);
  assert.deepEqual(found.map((row) => row.sessionId), [CODEX_SESSION]);

  const events = adapter.normalizeEvents(readFixture("codex-session.jsonl"));
  assert.equal(events.some((event) => event.text.includes("duplicate")), false);
  assert.equal(events.filter((event) => event.kind === "user_text").length, 1);
  assert.ok(events.some((event) => event.kind === "thinking"));
  assert.ok(events.some((event) => event.kind === "tool_call_summary" && event.text.includes("lib/auth/tokens.ts")));

  const state = stateFor(repo, CODEX_SESSION, record(repo, TOOL_CODEX, path.join(FIXTURES, "codex-session.jsonl")));
  const res = await distillSession(repo, CODEX_SESSION, state, DEFAULT_CONFIG, new MockBackend(() => JSON.stringify(CLERK_PACK)));
  assert.equal(res.ok, true, res.reason);
  assert.equal(res.branch, "guest-access");
  assert.ok(fs.existsSync(path.join(reasongraphPaths(repo).whyDir, "guest-access.md")));
  assert.equal(state.sessions[CODEX_SESSION].status, "distilled");

  fs.rmSync(repo, { recursive: true, force: true });
});

test("cursor-agent fixture distills into the why-pack", async () => {
  const repo = tempRepo();
  const projectsRoot = path.join(repo, "cursor-projects");
  const file = path.join(projectsRoot, cursorProjectSlug(repo), "agent-transcripts", CURSOR_SESSION, `${CURSOR_SESSION}.jsonl`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(path.join(FIXTURES, "cursor-agent-session.jsonl"), file);

  const found = new CursorAgentAdapter(projectsRoot).discoverSessions(repo);
  assert.deepEqual(found.map((row) => row.sessionId), [CURSOR_SESSION]);

  const state = stateFor(repo, CURSOR_SESSION, record(repo, TOOL_CURSOR_AGENT, file));
  const res = await distillSession(repo, CURSOR_SESSION, state, DEFAULT_CONFIG, new MockBackend(() => JSON.stringify(CLERK_PACK)));
  assert.equal(res.ok, true, res.reason);
  const packs = fs.readdirSync(reasongraphPaths(repo).whyDir);
  assert.equal(packs.length, 1);
  assert.equal(state.sessions[CURSOR_SESSION].files_touched.includes("lib/auth/tokens.ts"), true);

  fs.rmSync(repo, { recursive: true, force: true });
});

function loadOpenCode(repo: string): string {
  const file = path.join(repo, "opencode.db");
  const sql = readFixture("opencode-session.sql").replaceAll("__REPO__", repo);
  const db = new DatabaseSync(file);
  db.exec(sql);
  db.close();
  return file;
}

test("opencode reads session_v2, and a second distill sees only new rows", async () => {
  const repo = listWorktrees(tempRepo())[0];
  const dbFile = loadOpenCode(repo);
  const adapter = new OpenCodeAdapter(dbFile);
  const found = adapter.discoverSessions(repo);
  assert.deepEqual(
    found.map((row) => row.sessionId),
    [OPENCODE_SESSION],
    "adapter reads session_v2; the legacy session table is ignored",
  );

  const seen: string[] = [];
  const backend = new MockBackend((user) => {
    seen.push(user);
    return JSON.stringify(CLERK_PACK);
  });
  const state = stateFor(repo, OPENCODE_SESSION, record(repo, TOOL_OPENCODE, dbFile));
  const first = await distillSession(repo, OPENCODE_SESSION, state, DEFAULT_CONFIG, backend);
  assert.equal(first.ok, true, first.reason);
  assert.equal(state.sessions[OPENCODE_SESSION].last_distilled_cursor, OPENCODE_FIRST);
  assert.match(seen[0], new RegExp(FIRST_RULE));
  assert.equal(seen[0].includes("SYNTHETIC_INSTRUCTION"), false);
  assert.ok(fs.readdirSync(reasongraphPaths(repo).whyDir).length > 0);

  const db = new DatabaseSync(dbFile);
  db.prepare(INSERT_MESSAGE).run(
    OPENCODE_SECOND,
    OPENCODE_SESSION,
    TYPE_USER,
    2,
    2000,
    2000,
    JSON.stringify({ text: SECOND_RULE }),
  );
  db.close();

  const rec = state.sessions[OPENCODE_SESSION];
  rec.status = "distilled";
  rec.last_distilled_offset = fileSize(dbFile);
  assert.equal(fileSize(dbFile) > rec.last_distilled_offset, false);
  assert.equal(sessionsNeedingDistill(repo, state).includes(OPENCODE_SESSION), true);

  const second = await distillSession(repo, OPENCODE_SESSION, state, DEFAULT_CONFIG, backend);
  assert.equal(second.ok, true, second.reason);
  assert.equal(state.sessions[OPENCODE_SESSION].last_distilled_cursor, OPENCODE_SECOND);
  assert.match(seen[1], new RegExp(SECOND_RULE));
  assert.equal(seen[1].includes(FIRST_RULE), false);

  fs.rmSync(repo, { recursive: true, force: true });
});
