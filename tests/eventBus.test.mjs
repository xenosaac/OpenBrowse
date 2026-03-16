import test from "node:test";
import assert from "node:assert/strict";

import { EventBus } from "../packages/observability/dist/EventBus.js";

// --- subscribe + publish ---

test("EventBus: publishes to a subscribed handler", async () => {
  const bus = new EventBus();
  const received = [];
  bus.subscribe("ping", (p) => received.push(p));
  await bus.publish("ping", "hello");
  assert.deepEqual(received, ["hello"]);
});

test("EventBus: supports multiple handlers on the same event", async () => {
  const bus = new EventBus();
  const a = [];
  const b = [];
  bus.subscribe("evt", (p) => a.push(p));
  bus.subscribe("evt", (p) => b.push(p));
  await bus.publish("evt", 42);
  assert.deepEqual(a, [42]);
  assert.deepEqual(b, [42]);
});

test("EventBus: handlers fire in subscription order", async () => {
  const bus = new EventBus();
  const order = [];
  bus.subscribe("evt", () => order.push(1));
  bus.subscribe("evt", () => order.push(2));
  bus.subscribe("evt", () => order.push(3));
  await bus.publish("evt", null);
  assert.deepEqual(order, [1, 2, 3]);
});

test("EventBus: publish with no subscribers is a no-op", async () => {
  const bus = new EventBus();
  // Should not throw
  await bus.publish("nonexistent", { x: 1 });
});

test("EventBus: different event names are independent", async () => {
  const bus = new EventBus();
  const alpha = [];
  const beta = [];
  bus.subscribe("alpha", (p) => alpha.push(p));
  bus.subscribe("beta", (p) => beta.push(p));
  await bus.publish("alpha", "a");
  await bus.publish("beta", "b");
  assert.deepEqual(alpha, ["a"]);
  assert.deepEqual(beta, ["b"]);
});

test("EventBus: handler receives the exact payload", async () => {
  const bus = new EventBus();
  let captured;
  const payload = { key: "value", nested: { n: 1 } };
  bus.subscribe("data", (p) => { captured = p; });
  await bus.publish("data", payload);
  assert.equal(captured, payload); // same reference
});

test("EventBus: async handlers are awaited in order", async () => {
  const bus = new EventBus();
  const order = [];
  bus.subscribe("evt", async () => {
    await new Promise((r) => setTimeout(r, 10));
    order.push("slow");
  });
  bus.subscribe("evt", () => {
    order.push("fast");
  });
  await bus.publish("evt", null);
  // slow finishes before fast starts because handlers are sequential
  assert.deepEqual(order, ["slow", "fast"]);
});

test("EventBus: multiple publishes accumulate in handlers", async () => {
  const bus = new EventBus();
  const received = [];
  bus.subscribe("evt", (p) => received.push(p));
  await bus.publish("evt", 1);
  await bus.publish("evt", 2);
  await bus.publish("evt", 3);
  assert.deepEqual(received, [1, 2, 3]);
});

test("EventBus: handler throwing does not swallow the error", async () => {
  const bus = new EventBus();
  bus.subscribe("err", () => { throw new Error("boom"); });
  await assert.rejects(() => bus.publish("err", null), /boom/);
});

test("EventBus: async handler rejection propagates", async () => {
  const bus = new EventBus();
  bus.subscribe("err", async () => { throw new Error("async boom"); });
  await assert.rejects(() => bus.publish("err", null), /async boom/);
});
