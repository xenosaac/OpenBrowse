import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DISMISS_COOKIE_BANNER_SCRIPT } from "../packages/browser-runtime/src/cdp/dismissCookieBanner.ts";

describe("DISMISS_COOKIE_BANNER_SCRIPT", () => {
  test("exports a non-empty string", () => {
    assert.equal(typeof DISMISS_COOKIE_BANNER_SCRIPT, "string");
    assert.ok(DISMISS_COOKIE_BANNER_SCRIPT.length > 100, "Script should be substantial");
  });

  test("is a valid self-invoking function", () => {
    assert.ok(
      DISMISS_COOKIE_BANNER_SCRIPT.trim().startsWith("(function()"),
      "Should start with IIFE pattern"
    );
    assert.ok(
      DISMISS_COOKIE_BANNER_SCRIPT.trim().endsWith("()"),
      "Should end with IIFE invocation"
    );
  });

  test("contains OneTrust accept selector", () => {
    assert.ok(
      DISMISS_COOKIE_BANNER_SCRIPT.includes("#onetrust-accept-btn-handler"),
      "Should target OneTrust accept button"
    );
  });

  test("contains CookieBot accept selector", () => {
    assert.ok(
      DISMISS_COOKIE_BANNER_SCRIPT.includes("CybotCookiebotDialog"),
      "Should target CookieBot dialog"
    );
  });

  test("contains text matching for accept/agree patterns", () => {
    assert.ok(
      DISMISS_COOKIE_BANNER_SCRIPT.includes("accept"),
      "Should match accept text"
    );
    assert.ok(
      DISMISS_COOKIE_BANNER_SCRIPT.includes("agree"),
      "Should match agree text"
    );
    assert.ok(
      DISMISS_COOKIE_BANNER_SCRIPT.includes("allow"),
      "Should match allow text"
    );
  });

  test("returns dismissed:false when no banner found", () => {
    // The script should always return an object — verify the fallback return
    assert.ok(
      DISMISS_COOKIE_BANNER_SCRIPT.includes("{ dismissed: false }"),
      "Should return { dismissed: false } as fallback"
    );
  });

  test("returns dismissed:true with method on success", () => {
    assert.ok(
      DISMISS_COOKIE_BANNER_SCRIPT.includes("dismissed: true"),
      "Should return dismissed: true on successful click"
    );
    assert.ok(
      DISMISS_COOKIE_BANNER_SCRIPT.includes("method: 'direct_selector'"),
      "Should report method for direct selector matches"
    );
    assert.ok(
      DISMISS_COOKIE_BANNER_SCRIPT.includes("method: 'text_match'"),
      "Should report method for text-based matches"
    );
  });

  test("checks element visibility before clicking", () => {
    assert.ok(
      DISMISS_COOKIE_BANNER_SCRIPT.includes("isClickable"),
      "Should use visibility check before clicking"
    );
    assert.ok(
      DISMISS_COOKIE_BANNER_SCRIPT.includes("offsetWidth"),
      "Visibility check should verify element dimensions"
    );
  });

  test("includes GDPR/privacy container selectors", () => {
    assert.ok(
      DISMISS_COOKIE_BANNER_SCRIPT.includes("gdpr"),
      "Should detect GDPR-related containers"
    );
    assert.ok(
      DISMISS_COOKIE_BANNER_SCRIPT.includes("consent"),
      "Should detect consent-related containers"
    );
    assert.ok(
      DISMISS_COOKIE_BANNER_SCRIPT.includes("privacy"),
      "Should detect privacy-related containers"
    );
  });

  test("handles role=dialog containers for cookie banners", () => {
    assert.ok(
      DISMISS_COOKIE_BANNER_SCRIPT.includes('[role="dialog"]'),
      "Should check dialog-role containers"
    );
    // Must verify cookie-related text before clicking inside generic dialogs
    assert.ok(
      DISMISS_COOKIE_BANNER_SCRIPT.includes("isCookieRelated"),
      "Should verify dialog is cookie-related before dismissing"
    );
  });

  test("wraps in try-catch for resilience", () => {
    // Each strategy should catch errors to avoid breaking page model capture
    const catchCount = (DISMISS_COOKIE_BANNER_SCRIPT.match(/catch\s*\(/g) || []).length;
    assert.ok(catchCount >= 2, `Should have at least 2 try-catch blocks, found ${catchCount}`);
  });

  test("includes Didomi and Quantcast selectors", () => {
    assert.ok(
      DISMISS_COOKIE_BANNER_SCRIPT.includes("didomi"),
      "Should target Didomi consent platform"
    );
    assert.ok(
      DISMISS_COOKIE_BANNER_SCRIPT.includes("qc-cmp2"),
      "Should target Quantcast Choice CMP"
    );
  });
});
