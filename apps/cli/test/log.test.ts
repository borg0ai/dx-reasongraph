import { test } from "vitest";
import assert from "node:assert/strict";
import { formatProgress, supportsColor } from "../src/util/log.js";

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
