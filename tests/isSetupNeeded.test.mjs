import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { isSetupNeeded } from "../packages/runtime-core/dist/isSetupNeeded.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSettings(overrides = {}) {
  return {
    anthropicApiKey: "",
    plannerModel: "claude-sonnet-4-6",
    telegramBotToken: "",
    telegramChatId: "",
    telegramNotificationLevel: "quiet",
    riskClassPolicies: {},
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("isSetupNeeded", () => {
  test("returns false when settings is null (still loading)", () => {
    assert.equal(isSetupNeeded(null, false), false);
  });

  test("returns false when setupDismissed is null (still loading)", () => {
    assert.equal(isSetupNeeded(makeSettings(), null), false);
  });

  test("returns false when both are null", () => {
    assert.equal(isSetupNeeded(null, null), false);
  });

  test("returns false when setup was previously dismissed", () => {
    assert.equal(isSetupNeeded(makeSettings(), true), false);
  });

  test("returns false when API key is configured", () => {
    assert.equal(
      isSetupNeeded(makeSettings({ anthropicApiKey: "sk-ant-abc123" }), false),
      false
    );
  });

  test("returns false when API key is configured and dismissed", () => {
    assert.equal(
      isSetupNeeded(makeSettings({ anthropicApiKey: "sk-ant-abc123" }), true),
      false
    );
  });

  test("returns true when no API key and not dismissed", () => {
    assert.equal(isSetupNeeded(makeSettings(), false), true);
  });

  test("returns true when API key is whitespace-only and not dismissed", () => {
    assert.equal(
      isSetupNeeded(makeSettings({ anthropicApiKey: "   " }), false),
      true
    );
  });

  test("returns true when API key is empty string and not dismissed", () => {
    assert.equal(
      isSetupNeeded(makeSettings({ anthropicApiKey: "" }), false),
      true
    );
  });
});
