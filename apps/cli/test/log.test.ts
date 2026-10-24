import { test } from "vitest";
import assert from "node:assert/strict";
import { formatProgress, supportsColor, renderBar } from "../src/util/log.js";

test("progress output stays plain when color is disabled", () => {
  assert.equal(
    formatProgress("Saved config", "success", false),
    "✓ Saved config",
  );
});

test("progress output colors marker only when enabled", () => {
  assert.equal(
    formatProgress("Saved config", "success", true),
    "\u001b[32m✓\u001b[0m Saved config",
  );
  assert.equal(
    formatProgress("Setup failed", "error", true),
    "\u001b[31m✗\u001b[0m Setup failed",
  );
});

test("color support requires a TTY and unset NO_COLOR", () => {
  assert.equal(supportsColor(true, undefined), true);
  assert.equal(supportsColor(false, undefined), false);
  assert.equal(supportsColor(true, ""), false);
});

test("progress bar fills proportionally and clamps", () => {
  assert.equal(renderBar(0, 4, 8), "░░░░░░░░");
  assert.equal(renderBar(2, 4, 8), "████░░░░");
  assert.equal(renderBar(9, 4, 8), "████████");
});
