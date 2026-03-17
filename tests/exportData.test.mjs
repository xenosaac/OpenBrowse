import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Import the serialization module directly (pure functions, no Electron deps)
const { extractedDataToJson, extractedDataToCsv } = await import(
  "../apps/desktop/src/renderer/lib/exportData.ts"
);

describe("extractedDataToJson", () => {
  it("serializes normal data as pretty-printed JSON", () => {
    const data = [
      { label: "Name", value: "Keel-Billed Toucan" },
      { label: "Price", value: "$4,500" },
    ];
    const result = extractedDataToJson(data);
    const parsed = JSON.parse(result);
    assert.deepStrictEqual(parsed, data);
    // Verify pretty-printed (contains newlines)
    assert.ok(result.includes("\n"));
  });

  it("serializes empty array as []", () => {
    const result = extractedDataToJson([]);
    assert.deepStrictEqual(JSON.parse(result), []);
  });

  it("preserves special characters in values", () => {
    const data = [{ label: "Note", value: 'She said "hello" & goodbye' }];
    const result = extractedDataToJson(data);
    const parsed = JSON.parse(result);
    assert.equal(parsed[0].value, 'She said "hello" & goodbye');
  });
});

describe("extractedDataToCsv", () => {
  it("produces header + data rows", () => {
    const data = [
      { label: "Bird", value: "Toucan" },
      { label: "Price", value: "$4500" },
    ];
    const result = extractedDataToCsv(data);
    const lines = result.split("\n");
    assert.equal(lines[0], "Label,Value");
    assert.equal(lines[1], "Bird,Toucan");
    assert.equal(lines[2], "Price,$4500");
    assert.equal(lines.length, 3);
  });

  it("escapes commas in values", () => {
    const data = [{ label: "Price", value: "$4,500.00" }];
    const result = extractedDataToCsv(data);
    const lines = result.split("\n");
    assert.equal(lines[1], 'Price,"$4,500.00"');
  });

  it("escapes double quotes in values", () => {
    const data = [{ label: "Quote", value: 'She said "hi"' }];
    const result = extractedDataToCsv(data);
    const lines = result.split("\n");
    assert.equal(lines[1], 'Quote,"She said ""hi"""');
  });

  it("escapes newlines in values", () => {
    const data = [{ label: "Address", value: "123 Main St\nSuite 4" }];
    const result = extractedDataToCsv(data);
    const lines = result.split("\n");
    // The value should be quoted, so it'll span across "lines" in raw text
    assert.ok(result.includes('"123 Main St\nSuite 4"'));
  });

  it("handles empty data array", () => {
    const result = extractedDataToCsv([]);
    assert.equal(result, "Label,Value");
  });

  it("handles single item", () => {
    const data = [{ label: "Status", value: "OK" }];
    const result = extractedDataToCsv(data);
    const lines = result.split("\n");
    assert.equal(lines.length, 2);
    assert.equal(lines[1], "Status,OK");
  });

  it("escapes commas in labels", () => {
    const data = [{ label: "Name, Full", value: "John" }];
    const result = extractedDataToCsv(data);
    const lines = result.split("\n");
    assert.equal(lines[1], '"Name, Full",John');
  });
});
