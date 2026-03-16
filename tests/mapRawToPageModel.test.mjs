import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { mapRawToPageModel } from "../packages/browser-runtime/dist/mapRawToPageModel.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse the PageModel interface from contracts/src/browser.ts and extract
 * all field names.  This ensures that if a new field is added to the
 * PageModel contract, a test here will break unless the mapping and this
 * test fixture are also updated.
 */
function parsePageModelFields() {
  const src = readFileSync(
    path.resolve("packages/contracts/src/browser.ts"),
    "utf-8"
  );
  // Find the start of the PageModel interface
  const startMarker = "export interface PageModel {";
  const startIdx = src.indexOf(startMarker);
  if (startIdx === -1) throw new Error("Could not find PageModel interface in contracts/src/browser.ts");

  // Walk forward with brace counting to find the matching closing brace
  let depth = 0;
  let bodyStart = -1;
  for (let i = startIdx; i < src.length; i++) {
    if (src[i] === "{") {
      if (depth === 0) bodyStart = i + 1;
      depth++;
    } else if (src[i] === "}") {
      depth--;
      if (depth === 0) {
        const body = src.slice(bodyStart, i);
        // Extract only top-level field names (depth-1 fields — lines at 2-space indent)
        const fields = [];
        let innerDepth = 0;
        for (const line of body.split("\n")) {
          // Check field match BEFORE counting braces on this line,
          // so `tables?: Array<{` is detected at depth 0
          if (innerDepth === 0) {
            const fieldMatch = line.match(/^\s{2}(\w+)\??:/);
            if (fieldMatch) fields.push(fieldMatch[1]);
          }
          // Track nested braces so we skip fields inside sub-types
          for (const ch of line) {
            if (ch === "{") innerDepth++;
            else if (ch === "}") innerDepth--;
          }
        }
        return fields;
      }
    }
  }
  throw new Error("Could not parse PageModel interface — unbalanced braces");
}

/**
 * Build a fully-populated raw CDP result.  Every optional field is present
 * so we can verify the mapping preserves all of them.
 */
function buildFullRawInput() {
  return {
    url: "https://example.com/page",
    title: "Example Page",
    summary: "A test page summary",
    focusedElementId: "el_3",
    elements: [
      {
        id: "el_1",
        role: "link",
        label: "Click me",
        value: undefined,
        isActionable: true,
        href: "https://example.com/next",
        inputType: undefined,
        disabled: false,
        readonly: false,
        boundingVisible: true,
        boundingBox: { x: 10, y: 20, width: 100, height: 30 },
      },
    ],
    visibleText: "Hello world",
    pageType: "article",
    forms: [
      {
        action: "/submit",
        method: "POST",
        fieldCount: 2,
        fields: [
          { ref: "el_2", label: "Email", type: "email", required: true, currentValue: "" },
        ],
        submitRef: "el_5",
      },
    ],
    alerts: ["Session expired"],
    captchaDetected: true,
    cookieBannerDetected: true,
    scrollY: 150,
    activeDialog: { label: "Confirm action" },
    tables: [
      {
        caption: "Pricing",
        headers: ["Plan", "Price"],
        rowCount: 3,
        sampleRows: [["Basic", "$9"], ["Pro", "$29"]],
      },
    ],
    landmarks: [
      { role: "navigation", label: "Main nav" },
      { role: "main", label: "Content" },
    ],
    iframeCount: 2,
    iframeSources: ["https://ads.example.com", "https://widget.example.com"],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("mapRawToPageModel", () => {
  it("maps all required fields from raw input", () => {
    const raw = buildFullRawInput();
    const result = mapRawToPageModel(raw, "sess_42");

    assert.equal(result.url, raw.url);
    assert.equal(result.title, raw.title);
    assert.equal(result.summary, raw.summary);
    assert.deepStrictEqual(result.elements, raw.elements);
    assert.ok(result.id.startsWith("page_sess_42_"));
    assert.ok(result.createdAt); // ISO timestamp
  });

  it("maps all optional fields when present in raw input", () => {
    const raw = buildFullRawInput();
    const result = mapRawToPageModel(raw, "sess_1");

    assert.equal(result.focusedElementId, "el_3");
    assert.equal(result.visibleText, "Hello world");
    assert.equal(result.pageType, "article");
    assert.deepStrictEqual(result.forms, raw.forms);
    assert.deepStrictEqual(result.alerts, ["Session expired"]);
    assert.equal(result.captchaDetected, true);
    assert.equal(result.cookieBannerDetected, true);
    assert.equal(result.scrollY, 150);
    assert.deepStrictEqual(result.activeDialog, { label: "Confirm action" });
    assert.deepStrictEqual(result.tables, raw.tables);
    assert.deepStrictEqual(result.landmarks, raw.landmarks);
    assert.equal(result.iframeCount, 2);
    assert.deepStrictEqual(result.iframeSources, raw.iframeSources);
  });

  it("handles minimal raw input (only required fields)", () => {
    const raw = {
      url: "about:blank",
      title: "",
      summary: "",
      elements: [],
      visibleText: "",
    };
    const result = mapRawToPageModel(raw, "sess_min");

    assert.equal(result.url, "about:blank");
    assert.equal(result.title, "");
    assert.deepStrictEqual(result.elements, []);
    assert.equal(result.focusedElementId, undefined);
    assert.equal(result.forms, undefined);
    assert.equal(result.alerts, undefined);
    assert.equal(result.captchaDetected, undefined);
    assert.equal(result.cookieBannerDetected, undefined);
    assert.equal(result.scrollY, undefined);
    assert.equal(result.activeDialog, undefined);
    assert.equal(result.tables, undefined);
    assert.equal(result.landmarks, undefined);
    assert.equal(result.iframeCount, undefined);
    assert.equal(result.iframeSources, undefined);
  });

  it("generates unique id from session id", () => {
    const raw = buildFullRawInput();
    const r1 = mapRawToPageModel(raw, "s1");
    const r2 = mapRawToPageModel(raw, "s2");

    assert.ok(r1.id.startsWith("page_s1_"));
    assert.ok(r2.id.startsWith("page_s2_"));
    assert.notEqual(r1.id, r2.id);
  });

  it("casts pageType to PageModel union (undefined for invalid)", () => {
    const raw = buildFullRawInput();
    raw.pageType = undefined;
    const result = mapRawToPageModel(raw, "sess_x");
    assert.equal(result.pageType, undefined);
  });

  it("preserves table structure with all sub-fields", () => {
    const raw = buildFullRawInput();
    const result = mapRawToPageModel(raw, "sess_t");
    assert.equal(result.tables?.length, 1);
    const table = result.tables[0];
    assert.equal(table.caption, "Pricing");
    assert.deepStrictEqual(table.headers, ["Plan", "Price"]);
    assert.equal(table.rowCount, 3);
    assert.deepStrictEqual(table.sampleRows, [["Basic", "$9"], ["Pro", "$29"]]);
  });

  it("preserves form structure with nested fields", () => {
    const raw = buildFullRawInput();
    const result = mapRawToPageModel(raw, "sess_f");
    assert.equal(result.forms?.length, 1);
    const form = result.forms[0];
    assert.equal(form.action, "/submit");
    assert.equal(form.method, "POST");
    assert.equal(form.fieldCount, 2);
    assert.equal(form.fields?.length, 1);
    assert.equal(form.submitRef, "el_5");
  });
});

// ---------------------------------------------------------------------------
// Contract compliance: every PageModel field must survive the mapping
// ---------------------------------------------------------------------------

describe("mapRawToPageModel — contract compliance", () => {
  it("every PageModel field is either mapped or synthesised", () => {
    const contractFields = parsePageModelFields();
    const raw = buildFullRawInput();
    const result = mapRawToPageModel(raw, "sess_contract");

    // Fields synthesised by the mapper (not from raw input)
    const synthesised = new Set(["id", "createdAt"]);

    for (const field of contractFields) {
      if (synthesised.has(field)) {
        assert.ok(
          result[field] !== undefined,
          `Synthesised field "${field}" should be present in output`
        );
      } else {
        assert.ok(
          field in result,
          `PageModel field "${field}" is missing from mapRawToPageModel output. ` +
          `If you added a new field to the PageModel interface, you must also ` +
          `add it to mapRawToPageModel.ts and update this test fixture.`
        );
      }
    }
  });

  it("no PageModel field is silently dropped when raw input has it", () => {
    const contractFields = parsePageModelFields();
    const raw = buildFullRawInput();
    const result = mapRawToPageModel(raw, "sess_drop");

    // Fields that come from raw (not synthesised)
    const synthesised = new Set(["id", "createdAt"]);

    for (const field of contractFields) {
      if (synthesised.has(field)) continue;
      if (raw[field] !== undefined) {
        assert.notEqual(
          result[field],
          undefined,
          `PageModel field "${field}" is present in raw input but undefined in output — ` +
          `the mapping function is dropping it`
        );
      }
    }
  });

  it("contract field list matches expected count (catches new additions)", () => {
    const contractFields = parsePageModelFields();
    // PageModel currently has these fields:
    // id, url, title, summary, focusedElementId, elements, visibleText,
    // createdAt, pageType, forms, alerts, captchaDetected, cookieBannerDetected,
    // scrollY, activeDialog, tables, landmarks, iframeCount, iframeSources
    assert.equal(
      contractFields.length,
      19,
      `Expected 19 fields in PageModel but found ${contractFields.length}. ` +
      `If you added a new field, update mapRawToPageModel.ts, the raw fixture ` +
      `in this test, and this assertion.`
    );
  });
});
