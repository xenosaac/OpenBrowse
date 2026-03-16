import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { detectCycle } from "../packages/runtime-core/dist/RunExecutor.js";

// Helper: repeat a pattern N times to form an array
function repeat(pattern, times) {
  const result = [];
  for (let i = 0; i < times; i++) result.push(...pattern);
  return result;
}

// ---------------------------------------------------------------------------
// Basic: no cycle
// ---------------------------------------------------------------------------

describe("detectCycle — no cycle", () => {
  test("empty array returns 0", () => {
    assert.equal(detectCycle([]), 0);
  });

  test("single element returns 0", () => {
    assert.equal(detectCycle(["a"]), 0);
  });

  test("all distinct keys returns 0", () => {
    assert.equal(detectCycle(["a", "b", "c", "d", "e", "f", "g", "h"]), 0);
  });

  test("two alternating pairs (below threshold) returns 0", () => {
    // 2-step cycle needs 4 reps (8 elements); 3 reps (6 elements) is not enough
    assert.equal(detectCycle(["a", "b", "a", "b", "a", "b"]), 0);
  });

  test("three repeated triplets (below threshold for len-3) returns 0", () => {
    // 3-step cycle needs 3 reps (9 elements); 2 reps (6 elements) is not enough
    assert.equal(detectCycle(["a", "b", "c", "a", "b", "c"]), 0);
  });
});

// ---------------------------------------------------------------------------
// 2-step cycles (require 4 repetitions)
// ---------------------------------------------------------------------------

describe("detectCycle — 2-step cycles", () => {
  test("exactly 4 repetitions detected", () => {
    assert.equal(detectCycle(repeat(["a", "b"], 4)), 2);
  });

  test("5 repetitions still detected", () => {
    assert.equal(detectCycle(repeat(["a", "b"], 5)), 2);
  });

  test("3 repetitions NOT detected (below threshold)", () => {
    assert.equal(detectCycle(repeat(["a", "b"], 3)), 0);
  });

  test("cycle at tail with prefix noise detected", () => {
    const keys = ["x", "y", "z", ...repeat(["a", "b"], 4)];
    assert.equal(detectCycle(keys), 2);
  });

  test("near-miss: last element breaks the cycle", () => {
    const keys = repeat(["a", "b"], 4);
    keys[keys.length - 1] = "c"; // break last element
    assert.equal(detectCycle(keys), 0);
  });
});

// ---------------------------------------------------------------------------
// 3-step cycles (require 3 repetitions)
// ---------------------------------------------------------------------------

describe("detectCycle — 3-step cycles", () => {
  test("exactly 3 repetitions detected", () => {
    assert.equal(detectCycle(repeat(["a", "b", "c"], 3)), 3);
  });

  test("4 repetitions still detected", () => {
    assert.equal(detectCycle(repeat(["a", "b", "c"], 4)), 3);
  });

  test("2 repetitions NOT detected", () => {
    assert.equal(detectCycle(repeat(["a", "b", "c"], 2)), 0);
  });

  test("cycle at tail with prefix noise detected", () => {
    const keys = ["w", "x", ...repeat(["a", "b", "c"], 3)];
    assert.equal(detectCycle(keys), 3);
  });
});

// ---------------------------------------------------------------------------
// 4-step cycles (require 3 repetitions)
// ---------------------------------------------------------------------------

describe("detectCycle — 4-step cycles", () => {
  test("exactly 3 repetitions detected", () => {
    assert.equal(detectCycle(repeat(["a", "b", "c", "d"], 3)), 4);
  });

  test("2 repetitions NOT detected", () => {
    assert.equal(detectCycle(repeat(["a", "b", "c", "d"], 2)), 0);
  });
});

// ---------------------------------------------------------------------------
// 5-step cycles (require 3 repetitions)
// ---------------------------------------------------------------------------

describe("detectCycle — 5-step cycles", () => {
  test("exactly 3 repetitions detected", () => {
    assert.equal(detectCycle(repeat(["a", "b", "c", "d", "e"], 3)), 5);
  });

  test("2 repetitions NOT detected", () => {
    assert.equal(detectCycle(repeat(["a", "b", "c", "d", "e"], 2)), 0);
  });
});

// ---------------------------------------------------------------------------
// 6-step patterns (beyond detection range)
// ---------------------------------------------------------------------------

describe("detectCycle — beyond max cycle length", () => {
  test("6-step repeating pattern NOT detected (max is 5)", () => {
    assert.equal(detectCycle(repeat(["a", "b", "c", "d", "e", "f"], 3)), 0);
  });
});

// ---------------------------------------------------------------------------
// Priority: shorter cycles detected first
// ---------------------------------------------------------------------------

describe("detectCycle — priority", () => {
  test("2-step cycle takes priority over 4-step when both match", () => {
    // ["a","b","a","b"] repeated 4 times also forms a 4-step cycle of ["a","b","a","b"] repeated 2 times
    // But since 2-step is checked first and has 4 reps, it wins
    const keys = repeat(["a", "b"], 4);
    assert.equal(detectCycle(keys), 2);
  });
});

// ---------------------------------------------------------------------------
// Real-world-like keys
// ---------------------------------------------------------------------------

describe("detectCycle — realistic action keys", () => {
  test("click-then-scroll cycle detected", () => {
    const pattern = [
      "click:btn-submit::https://example.com",
      "scroll:::https://example.com"
    ];
    assert.equal(detectCycle(repeat(pattern, 4)), 2);
  });

  test("3-step navigation loop detected", () => {
    const pattern = [
      "click:link-a:Go to A:https://example.com/a",
      "click:link-b:Go to B:https://example.com/b",
      "click:link-home:Go home:https://example.com"
    ];
    assert.equal(detectCycle(repeat(pattern, 3)), 3);
  });

  test("similar but distinct actions NOT detected as cycle", () => {
    // Different targetIds make each action unique
    const keys = [];
    for (let i = 0; i < 20; i++) {
      keys.push(`click:btn-${i}:Submit:https://example.com`);
    }
    assert.equal(detectCycle(keys), 0);
  });

  test("same type but different descriptions NOT detected as cycle", () => {
    const keys = [
      "click:btn:Buy item 1:https://shop.com",
      "click:btn:Buy item 2:https://shop.com",
      "click:btn:Buy item 1:https://shop.com",
      "click:btn:Buy item 2:https://shop.com",
      "click:btn:Buy item 1:https://shop.com",
      "click:btn:Buy item 2:https://shop.com"
    ];
    // Only 3 reps of 2-step cycle, needs 4
    assert.equal(detectCycle(keys), 0);
  });

  test("same type+description cycle at 4 reps detected", () => {
    const keys = repeat([
      "click:btn:Buy item 1:https://shop.com",
      "click:btn:Buy item 2:https://shop.com"
    ], 4);
    assert.equal(detectCycle(keys), 2);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("detectCycle — edge cases", () => {
  test("all identical elements detected as 2-step cycle (shortest match)", () => {
    // 8 identical elements: ["a","a","a","a","a","a","a","a"]
    // This is a valid 2-step cycle of ["a","a"] repeated 4 times
    assert.equal(detectCycle(Array(8).fill("a")), 2);
  });

  test("7 identical elements returns 0 (below min threshold)", () => {
    // len=2 needs 8, len=3 needs 9, len=4 needs 12, len=5 needs 15
    assert.equal(detectCycle(Array(7).fill("a")), 0);
  });

  test("8 identical elements detected as 2-step", () => {
    assert.equal(detectCycle(Array(8).fill("a")), 2);
  });

  test("9 identical elements detected as 2-step (shortest wins)", () => {
    // Both 2-step (needs 8) and 3-step (needs 9) would match, but 2 is checked first
    assert.equal(detectCycle(Array(9).fill("a")), 2);
  });
});
