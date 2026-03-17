import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { CdpClient } from "../packages/browser-runtime/dist/cdp/CdpClient.js";

// ---------------------------------------------------------------------------
// Mock WebContents with a mock debugger
// ---------------------------------------------------------------------------

function makeMockWebContents(overrides = {}) {
  const calls = [];
  const mockDebugger = {
    attach(version) {
      calls.push({ method: "attach", args: [version] });
      if (overrides.attachThrows) throw new Error("attach failed");
    },
    detach() {
      calls.push({ method: "detach", args: [] });
      if (overrides.detachThrows) throw new Error("Already detached");
    },
    async sendCommand(method, params) {
      calls.push({ method: "sendCommand", args: [method, params] });
      if (overrides.sendCommandHandler) {
        return overrides.sendCommandHandler(method, params, calls);
      }
      // Default responses per CDP method
      if (method === "Runtime.evaluate") {
        if (params?.returnByValue === false) {
          // globalThis context fetch
          return { result: { objectId: overrides.objectId ?? "obj_1" } };
        }
        return { result: { value: overrides.evaluateResult ?? 42 } };
      }
      if (method === "Runtime.callFunctionOn") {
        return { result: { value: overrides.callFunctionResult ?? "ok" } };
      }
      return overrides.defaultResult ?? {};
    },
  };
  return { debugger: mockDebugger, _calls: calls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CdpClient", () => {
  describe("attach", () => {
    it("calls debugger.attach with protocol version 1.3", async () => {
      const wc = makeMockWebContents();
      const cdp = new CdpClient(wc);
      await cdp.attach();
      assert.equal(wc._calls.length, 1);
      assert.equal(wc._calls[0].method, "attach");
      assert.deepEqual(wc._calls[0].args, ["1.3"]);
    });

    it("is idempotent — second attach is a no-op", async () => {
      const wc = makeMockWebContents();
      const cdp = new CdpClient(wc);
      await cdp.attach();
      await cdp.attach();
      const attachCalls = wc._calls.filter((c) => c.method === "attach");
      assert.equal(attachCalls.length, 1, "attach should only be called once");
    });
  });

  describe("detach", () => {
    it("calls debugger.detach and clears state", async () => {
      const wc = makeMockWebContents();
      const cdp = new CdpClient(wc);
      await cdp.attach();
      await cdp.detach();
      const detachCalls = wc._calls.filter((c) => c.method === "detach");
      assert.equal(detachCalls.length, 1);
    });

    it("is idempotent when not attached — no-op", async () => {
      const wc = makeMockWebContents();
      const cdp = new CdpClient(wc);
      await cdp.detach(); // never attached
      const detachCalls = wc._calls.filter((c) => c.method === "detach");
      assert.equal(detachCalls.length, 0, "should not call detach when not attached");
    });

    it("swallows errors from already-detached debugger", async () => {
      const wc = makeMockWebContents({ detachThrows: true });
      const cdp = new CdpClient(wc);
      await cdp.attach();
      // Should not throw
      await cdp.detach();
    });
  });

  describe("send", () => {
    it("auto-attaches if not attached, then delegates to sendCommand", async () => {
      const wc = makeMockWebContents({ defaultResult: { ok: true } });
      const cdp = new CdpClient(wc);
      // Not attached yet — send should auto-attach
      const result = await cdp.send("Page.enable");
      assert.deepEqual(result, { ok: true });
      const attachCalls = wc._calls.filter((c) => c.method === "attach");
      assert.equal(attachCalls.length, 1, "should auto-attach");
      const sendCalls = wc._calls.filter((c) => c.method === "sendCommand");
      assert.equal(sendCalls.length, 1);
      assert.equal(sendCalls[0].args[0], "Page.enable");
    });

    it("propagates sendCommand errors as rejections", async () => {
      const wc = makeMockWebContents({
        sendCommandHandler() {
          throw new Error("CDP error");
        },
      });
      const cdp = new CdpClient(wc);
      await cdp.attach();
      await assert.rejects(() => cdp.send("Bad.method"), { message: "CDP error" });
    });
  });

  describe("evaluate", () => {
    it("sends Runtime.evaluate with correct params and extracts result.value", async () => {
      const wc = makeMockWebContents({ evaluateResult: "hello" });
      const cdp = new CdpClient(wc);
      const result = await cdp.evaluate("1 + 1");
      assert.equal(result, "hello");
      const sendCalls = wc._calls.filter((c) => c.method === "sendCommand");
      assert.equal(sendCalls.length, 1);
      assert.equal(sendCalls[0].args[0], "Runtime.evaluate");
      assert.deepEqual(sendCalls[0].args[1], {
        expression: "1 + 1",
        returnByValue: true,
        awaitPromise: true,
      });
    });
  });

  describe("callFunction", () => {
    it("fetches globalThis objectId, caches it, and calls Runtime.callFunctionOn", async () => {
      const wc = makeMockWebContents({ objectId: "ctx_42", callFunctionResult: 99 });
      const cdp = new CdpClient(wc);
      const result = await cdp.callFunction("function(a) { return a; }", 5);
      assert.equal(result, 99);

      const sendCalls = wc._calls.filter((c) => c.method === "sendCommand");
      // 1st: auto-attach triggers, then Runtime.evaluate for globalThis, then Runtime.callFunctionOn
      assert.equal(sendCalls[0].args[0], "Runtime.evaluate");
      assert.equal(sendCalls[0].args[1].expression, "globalThis");
      assert.equal(sendCalls[0].args[1].returnByValue, false);
      assert.equal(sendCalls[1].args[0], "Runtime.callFunctionOn");
      assert.equal(sendCalls[1].args[1].objectId, "ctx_42");
      assert.deepEqual(sendCalls[1].args[1].arguments, [{ value: 5 }]);
    });

    it("caches objectId across multiple callFunction invocations", async () => {
      const wc = makeMockWebContents({ objectId: "ctx_1", callFunctionResult: "ok" });
      const cdp = new CdpClient(wc);
      await cdp.callFunction("fn1");
      await cdp.callFunction("fn2");

      const evalCalls = wc._calls.filter(
        (c) => c.method === "sendCommand" && c.args[0] === "Runtime.evaluate"
      );
      // globalThis should be fetched only once
      assert.equal(evalCalls.length, 1, "should cache objectId — only 1 evaluate call");
    });

    it("maps undefined args to unserializableValue", async () => {
      const wc = makeMockWebContents({ callFunctionResult: "ok" });
      const cdp = new CdpClient(wc);
      await cdp.callFunction("fn", undefined, 42, undefined);

      const callOnCalls = wc._calls.filter(
        (c) => c.method === "sendCommand" && c.args[0] === "Runtime.callFunctionOn"
      );
      assert.equal(callOnCalls.length, 1);
      assert.deepEqual(callOnCalls[0].args[1].arguments, [
        { unserializableValue: "undefined" },
        { value: 42 },
        { unserializableValue: "undefined" },
      ]);
    });

    it("retries with fresh objectId on stale context error", async () => {
      let callCount = 0;
      const wc = makeMockWebContents({
        sendCommandHandler(method, params) {
          if (method === "Runtime.evaluate") {
            if (params?.returnByValue === false) {
              callCount++;
              return { result: { objectId: `ctx_${callCount}` } };
            }
            return { result: { value: null } };
          }
          if (method === "Runtime.callFunctionOn") {
            if (params.objectId === "ctx_1") {
              // First call fails — stale context
              throw new Error("Cannot find context with specified id");
            }
            // Retry with ctx_2 succeeds
            return { result: { value: "recovered" } };
          }
          return {};
        },
      });
      const cdp = new CdpClient(wc);
      const result = await cdp.callFunction("fn");
      assert.equal(result, "recovered");

      // Should have 2 evaluate calls (initial + re-fetch) and 2 callFunctionOn calls
      const evalCalls = wc._calls.filter(
        (c) => c.method === "sendCommand" && c.args[0] === "Runtime.evaluate"
      );
      const callOnCalls = wc._calls.filter(
        (c) => c.method === "sendCommand" && c.args[0] === "Runtime.callFunctionOn"
      );
      assert.equal(evalCalls.length, 2, "should re-fetch objectId after stale error");
      assert.equal(callOnCalls.length, 2, "should retry callFunctionOn");
      assert.equal(callOnCalls[1].args[1].objectId, "ctx_2", "retry uses new objectId");
    });

    it("propagates error when retry also fails", async () => {
      const wc = makeMockWebContents({
        sendCommandHandler(method, params) {
          if (method === "Runtime.evaluate") {
            if (params?.returnByValue === false) {
              return { result: { objectId: "ctx_bad" } };
            }
            return { result: { value: null } };
          }
          if (method === "Runtime.callFunctionOn") {
            throw new Error("Permanent CDP failure");
          }
          return {};
        },
      });
      const cdp = new CdpClient(wc);
      await assert.rejects(() => cdp.callFunction("fn"), {
        message: "Permanent CDP failure",
      });
    });
  });

  describe("invalidateContext", () => {
    it("clears cached objectId so next callFunction re-fetches", async () => {
      let evalCount = 0;
      const wc = makeMockWebContents({
        sendCommandHandler(method, params) {
          if (method === "Runtime.evaluate" && params?.returnByValue === false) {
            evalCount++;
            return { result: { objectId: `ctx_${evalCount}` } };
          }
          if (method === "Runtime.callFunctionOn") {
            return { result: { value: "ok" } };
          }
          return {};
        },
      });
      const cdp = new CdpClient(wc);

      await cdp.callFunction("fn1");
      assert.equal(evalCount, 1);

      cdp.invalidateContext();

      await cdp.callFunction("fn2");
      assert.equal(evalCount, 2, "should re-fetch objectId after invalidation");
    });
  });
});
