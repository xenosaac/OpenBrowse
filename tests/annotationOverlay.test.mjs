import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  INJECT_ANNOTATION_OVERLAY_SCRIPT,
  REMOVE_ANNOTATION_OVERLAY_SCRIPT
} from "../packages/browser-runtime/src/cdp/annotationOverlay.ts";

describe("INJECT_ANNOTATION_OVERLAY_SCRIPT", () => {
  test("exports a non-empty string", () => {
    assert.equal(typeof INJECT_ANNOTATION_OVERLAY_SCRIPT, "string");
    assert.ok(INJECT_ANNOTATION_OVERLAY_SCRIPT.length > 100, "Script should be substantial");
  });

  test("is a valid self-invoking function", () => {
    assert.ok(
      INJECT_ANNOTATION_OVERLAY_SCRIPT.trim().startsWith("(function()"),
      "Should start with IIFE pattern"
    );
  });

  test("uses data-openbrowse-target-id attribute to find elements", () => {
    assert.ok(
      INJECT_ANNOTATION_OVERLAY_SCRIPT.includes("data-openbrowse-target-id"),
      "Should query elements by target-id attribute"
    );
  });

  test("caps annotations at 50 elements", () => {
    assert.ok(
      INJECT_ANNOTATION_OVERLAY_SCRIPT.includes("MAX = 50"),
      "Should define MAX = 50 cap"
    );
    assert.ok(
      INJECT_ANNOTATION_OVERLAY_SCRIPT.includes("count < MAX"),
      "Should enforce the cap in the loop"
    );
  });

  test("creates a fixed overlay container with highest z-index", () => {
    assert.ok(
      INJECT_ANNOTATION_OVERLAY_SCRIPT.includes("position:fixed"),
      "Container should use fixed positioning"
    );
    assert.ok(
      INJECT_ANNOTATION_OVERLAY_SCRIPT.includes("z-index:2147483647"),
      "Container should use max z-index"
    );
    assert.ok(
      INJECT_ANNOTATION_OVERLAY_SCRIPT.includes("pointer-events:none"),
      "Container should not intercept clicks"
    );
  });

  test("uses a stable container ID for idempotent injection", () => {
    assert.ok(
      INJECT_ANNOTATION_OVERLAY_SCRIPT.includes("__openbrowse_annotation_overlay__"),
      "Should use a unique container ID"
    );
  });

  test("skips elements with zero bounding box or outside viewport", () => {
    assert.ok(
      INJECT_ANNOTATION_OVERLAY_SCRIPT.includes("rect.width <= 0"),
      "Should skip zero-width elements"
    );
    assert.ok(
      INJECT_ANNOTATION_OVERLAY_SCRIPT.includes("rect.bottom < 0"),
      "Should skip elements above viewport"
    );
  });

  test("returns injection count", () => {
    assert.ok(
      INJECT_ANNOTATION_OVERLAY_SCRIPT.includes("{ injected: count }"),
      "Should return the number of injected annotations"
    );
  });
});

describe("REMOVE_ANNOTATION_OVERLAY_SCRIPT", () => {
  test("exports a non-empty string", () => {
    assert.equal(typeof REMOVE_ANNOTATION_OVERLAY_SCRIPT, "string");
    assert.ok(REMOVE_ANNOTATION_OVERLAY_SCRIPT.length > 20, "Script should be non-trivial");
  });

  test("is a valid self-invoking function", () => {
    assert.ok(
      REMOVE_ANNOTATION_OVERLAY_SCRIPT.trim().startsWith("(function()"),
      "Should start with IIFE pattern"
    );
  });

  test("targets the same container ID as injection", () => {
    assert.ok(
      REMOVE_ANNOTATION_OVERLAY_SCRIPT.includes("__openbrowse_annotation_overlay__"),
      "Should target the same container ID"
    );
  });

  test("returns removal status", () => {
    assert.ok(
      REMOVE_ANNOTATION_OVERLAY_SCRIPT.includes("{ removed: true }"),
      "Should return true when overlay was present"
    );
    assert.ok(
      REMOVE_ANNOTATION_OVERLAY_SCRIPT.includes("{ removed: false }"),
      "Should return false when no overlay found"
    );
  });
});
