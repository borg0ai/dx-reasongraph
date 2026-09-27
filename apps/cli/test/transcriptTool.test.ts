import { test } from "vitest";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { toolForTranscript } from "../src/adapters/index.js";
import { TOOL_CLAUDE_CODE, TOOL_CODEX, TOOL_CURSOR_AGENT, TOOL_OPENCODE } from "../src/adapters/names.js";
import { discoverAndSync } from "../src/core/sweep.js";
import { correctSessionTool } from "../src/core/sessionTool.js";
import { distillSession, NO_EVENTS_REASON } from "../src/core/distillSession.js";
import { SessionRecord, StateFile } from "../src/state/state.js";
import { DEFAULT_CONFIG } from "../src/util/config.js";
import { claudeProjectsDir } from "../src/util/paths.js";
import { MockBackend, readFixture } from "./helpers.js";

const CODEX_SESSION = "codex-fixture";
const GUEST_TEXT = "Keep guest tokens short.";

function tempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reasongraph-tool-"));
  spawnSync("git", ["init", "-q"], { cwd: dir });
  spawnSync("git", ["config", "user.email", "t@t.co"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "t"], { cwd: dir });
  fs.writeFileSync(path.join(dir, ".keep"), "");
  spawnSync("git", ["add", ".keep"], { cwd: dir });
  spawnSync("git", ["commit", "-qm", "init"], { cwd: dir });
  spawnSync("git", ["branch", "guest-access"], { cwd: dir });
  return dir;
}

function sealed(repo: string, transcript: string, tool: string): SessionRecord {
  return {
    tool,
    transcript_path: transcript,
    repo,
    branches_seen: [],
    files_touched: [],
    first_seen: "2026-09-01T00:00:00Z",
    last_seen: "2026-09-01T00:00:00Z",
    last_distilled_offset: 999,
    status: "distilled",
  };
}

test("toolForTranscript follows the path, and an unknown path matches nothing", () => {
  const codex = path.join(os.homedir(), ".codex", "sessions", "2026", "09", "01", "rollout.jsonl");
  const cursor = path.join("/tmp", "proj", "agent-transcripts", "abc", "abc.jsonl");
  const opencode = path.join("/tmp", "share", "opencode.db");
  const claude = path.join(claudeProjectsDir(), "proj", "sess.jsonl");
  const sibling = path.join(os.homedir(), ".codex", "sessions-other", "rollout.jsonl");

  assert.equal(toolForTranscript(codex), TOOL_CODEX);
  assert.equal(toolForTranscript(cursor), TOOL_CURSOR_AGENT);
  assert.equal(toolForTranscript(opencode), TOOL_OPENCODE);
  assert.equal(toolForTranscript(claude), TOOL_CLAUDE_CODE);
  assert.equal(toolForTranscript(sibling), undefined);
  assert.equal(toolForTranscript(path.join("/tmp", "notes.txt")), undefined);
});

test("correctSessionTool rewinds a Codex path that was stored as claude-code", () => {
  const transcript = path.join(os.homedir(), ".codex", "sessions", "2026", "09", "01", "rollout.jsonl");
  const rec = sealed("/repo", transcript, TOOL_CLAUDE_CODE);
  assert.equal(correctSessionTool(rec), true);
  assert.equal(rec.tool, TOOL_CODEX);
  assert.equal(rec.last_distilled_offset, 0);
  assert.equal(rec.status, "dirty");
  assert.equal(correctSessionTool(rec), false);
});

test("discoverAndSync rewinds a sealed Codex session mislabeled as claude-code", () => {
  // git worktree list reports the real path. The transcript cwd has to match that,
  // not the symlinked tmpdir path mkdtemp returns on macOS.
  const repo = fs.realpathSync(tempRepo());
  const sessionsRoot = path.join(os.homedir(), ".codex", "sessions");
  const dir = fs.mkdtempSync(path.join(sessionsRoot, "reasongraph-test-"));
  const file = path.join(dir, "rollout.jsonl");
  try {
    fs.writeFileSync(file, readFixture("codex-session.jsonl").replace('"/repo"', JSON.stringify(repo)));
    const state: StateFile = {
      version: 1,
      sessions: { [CODEX_SESSION]: sealed(repo, file, TOOL_CLAUDE_CODE) },
    };
    discoverAndSync(repo, state);
    const rec = state.sessions[CODEX_SESSION];
    assert.equal(rec.tool, TOOL_CODEX);
    assert.equal(rec.last_distilled_offset, 0);
    assert.equal(rec.status, "dirty");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("a mislabeled Codex transcript is distilled by the Codex adapter", async () => {
  const repo = tempRepo();
  const sessionsRoot = path.join(os.homedir(), ".codex", "sessions");
  const dir = fs.mkdtempSync(path.join(sessionsRoot, "reasongraph-test-"));
  const file = path.join(dir, "rollout.jsonl");
  const seen: string[] = [];
  try {
    fs.writeFileSync(file, readFixture("codex-session.jsonl").replace('"/repo"', JSON.stringify(repo)));
    const state: StateFile = {
      version: 1,
      sessions: { [CODEX_SESSION]: sealed(repo, file, TOOL_CLAUDE_CODE) },
    };
    const backend = new MockBackend((user) => {
      seen.push(user);
      return JSON.stringify({ intent: "Keep guest tokens short.", decisions: [] });
    });
    const res = await distillSession(repo, CODEX_SESSION, state, DEFAULT_CONFIG, backend);
    assert.equal(res.ok, true, res.reason);
    assert.equal(state.sessions[CODEX_SESSION].tool, TOOL_CODEX);
    assert.match(seen[0] ?? "", new RegExp(GUEST_TEXT));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("non-empty transcript with zero events stays dirty and does not advance the offset", async () => {
  const repo = tempRepo();
  const file = path.join(repo, "unknown.jsonl");
  fs.writeFileSync(file, "{\"type\":\"response_item\"}\n");
  const rec = sealed(repo, file, TOOL_CLAUDE_CODE);
  rec.last_distilled_offset = 0;
  const state: StateFile = { version: 1, sessions: { bad: rec } };
  const backend = new MockBackend(() => "{}");

  const res = await distillSession(repo, "bad", state, DEFAULT_CONFIG, backend);
  assert.equal(res.ok, false);
  assert.equal(res.reason, NO_EVENTS_REASON);
  assert.equal(state.sessions.bad.status, "dirty");
  assert.equal(state.sessions.bad.last_distilled_offset, 0);
  assert.equal(state.sessions.bad.tool, TOOL_CLAUDE_CODE);
  assert.equal(backend.calls, 0);

  fs.rmSync(repo, { recursive: true, force: true });
});
