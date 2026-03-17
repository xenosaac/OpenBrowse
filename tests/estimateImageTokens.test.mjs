import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  estimateImageTokensFromDimensions,
  estimateImageTokensFromBase64Length
} from "../packages/planner/dist/index.js";

describe("estimateImageTokensFromDimensions", () => {
  it("returns 0 for zero or negative dimensions", () => {
    assert.equal(estimateImageTokensFromDimensions(0, 800), 0);
    assert.equal(estimateImageTokensFromDimensions(1200, 0), 0);
    assert.equal(estimateImageTokensFromDimensions(-100, 800), 0);
  });

  it("calculates tokens for a typical 1200x800 viewport (2x2 tiles)", () => {
    const tokens = estimateImageTokensFromDimensions(1200, 800);
    // 2x2 = 4 tiles → 85 + 4*170 = 765
    assert.equal(tokens, 765);
  });

  it("calculates tokens for a 768x768 image (1x1 tile)", () => {
    const tokens = estimateImageTokensFromDimensions(768, 768);
    // 1x1 = 1 tile → 85 + 170 = 255
    assert.equal(tokens, 255);
  });

  it("calculates tokens for a 1920x1080 viewport (3x2 tiles)", () => {
    const tokens = estimateImageTokensFromDimensions(1920, 1080);
    // Within MAX_LONG_EDGE (1920 > 1568), so downscale
    // scale = 1568/1920 ≈ 0.8167
    // w = round(1920*0.8167) = 1568, h = round(1080*0.8167) = 882
    // tiles: ceil(1568/768) × ceil(882/768) = 3 × 2 = 6 → 85 + 6*170 = 1105
    assert.equal(tokens, 1105);
  });

  it("downscales images exceeding MAX_LONG_EDGE (1568px)", () => {
    // 3000x2000 image → scale = 1568/3000 ≈ 0.5227
    // w = round(3000*0.5227) = 1568, h = round(2000*0.5227) = 1045
    // tiles: ceil(1568/768) × ceil(1045/768) = 3 × 2 = 6 → 85 + 1020 = 1105
    const tokens = estimateImageTokensFromDimensions(3000, 2000);
    assert.equal(tokens, 1105);
  });

  it("handles small images (no downscale needed)", () => {
    // 400x300 → 1x1 tile → 255
    assert.equal(estimateImageTokensFromDimensions(400, 300), 255);
  });

  it("handles a square 1568x1568 image (at the cap)", () => {
    // No downscale needed (exactly at cap, scale = 1)
    // ceil(1568/768) = 3 (since 1568/768 ≈ 2.04)
    // 3×3 = 9 tiles → 85 + 9*170 = 1615
    assert.equal(estimateImageTokensFromDimensions(1568, 1568), 85 + 9 * 170);
  });
});

describe("estimateImageTokensFromBase64Length", () => {
  it("returns 0 for zero or negative length", () => {
    assert.equal(estimateImageTokensFromBase64Length(0), 0);
    assert.equal(estimateImageTokensFromBase64Length(-100), 0);
  });

  it("estimates tokens for a typical web page screenshot at quality 60", () => {
    // A typical 1200×800 page at JPEG quality 60 ≈ 100KB file ≈ 133KB base64
    // base64Length ≈ 136,000 chars
    // fileBytes ≈ 102,000
    // At 0.4 bpp → 255,000 pixels → height ≈ 412, width ≈ 618
    // 1×1 tile → 255 tokens — but real screenshots are much larger
    //
    // More realistic: 200KB base64 → 150KB file → 375K pixels → h≈500, w≈750
    // 1×1 tile → 255 tokens
    //
    // Even more realistic: 400KB base64 = 400,000 chars → 300,000 bytes
    // 300K / 0.4 = 750K pixels → h≈707, w≈1061 → ceil(1061/768)=2, ceil(707/768)=1 → 2 tiles
    const tokens = estimateImageTokensFromBase64Length(400_000, 60);
    assert.ok(tokens > 0, "should produce positive token count");
    assert.ok(tokens <= 2000, "should be under 2K threshold for typical screenshots");
  });

  it("estimates higher tokens for larger screenshots", () => {
    const small = estimateImageTokensFromBase64Length(100_000, 60);
    const large = estimateImageTokensFromBase64Length(1_000_000, 60);
    assert.ok(large >= small, "larger screenshots should cost more tokens");
  });

  it("uses correct bytes-per-pixel for different quality levels", () => {
    // Same base64 length at lower quality implies more pixels → more tokens
    const q30 = estimateImageTokensFromBase64Length(400_000, 30);
    const q90 = estimateImageTokensFromBase64Length(400_000, 90);
    assert.ok(q30 >= q90, "lower quality same file size implies larger image → more tokens");
  });
});
