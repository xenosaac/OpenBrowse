import type { WebContents } from "electron";

export class CdpClient {
  private attached = false;
  private contextObjectId: string | null = null;

  constructor(private readonly webContents: WebContents) {}

  async attach(): Promise<void> {
    if (this.attached) return;
    this.webContents.debugger.attach("1.3");
    this.attached = true;
  }

  async detach(): Promise<void> {
    if (!this.attached) return;
    try {
      this.webContents.debugger.detach();
    } catch {
      // Already detached
    }
    this.attached = false;
    this.contextObjectId = null;
  }

  /** Discard the cached execution context. Call after page navigation. */
  invalidateContext(): void {
    this.contextObjectId = null;
  }

  async send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.attached) {
      await this.attach();
    }
    return this.webContents.debugger.sendCommand(method, params) as T;
  }

  async evaluate<T = unknown>(expression: string): Promise<T> {
    const result = await this.send<{ result: { value: T } }>("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    return result.result.value;
  }

  /**
   * Call a function declaration with typed arguments via Runtime.callFunctionOn.
   * Arguments are passed as CDP call arguments — never interpolated into the
   * expression string — which eliminates injection risk.
   */
  async callFunction<T = unknown>(functionDeclaration: string, ...args: unknown[]): Promise<T> {
    // Fetch and cache the global execution context objectId — reuse across calls
    // until the context is invalidated (e.g. after page navigation).
    if (!this.contextObjectId) {
      const ctx = await this.send<{ result: { objectId: string } }>("Runtime.evaluate", {
        expression: "globalThis",
        returnByValue: false
      });
      this.contextObjectId = ctx.result.objectId;
    }

    const callArguments = args.map((arg) => {
      if (arg === undefined) return { unserializableValue: "undefined" };
      return { value: arg };
    });

    try {
      const result = await this.send<{ result: { value: T } }>("Runtime.callFunctionOn", {
        functionDeclaration,
        objectId: this.contextObjectId,
        arguments: callArguments,
        returnByValue: true,
        awaitPromise: true
      });
      return result.result.value;
    } catch (err) {
      // If the cached objectId has gone stale (navigation happened without invalidation),
      // re-fetch once and retry.
      this.contextObjectId = null;
      const ctx = await this.send<{ result: { objectId: string } }>("Runtime.evaluate", {
        expression: "globalThis",
        returnByValue: false
      });
      this.contextObjectId = ctx.result.objectId;

      const result = await this.send<{ result: { value: T } }>("Runtime.callFunctionOn", {
        functionDeclaration,
        objectId: this.contextObjectId,
        arguments: callArguments,
        returnByValue: true,
        awaitPromise: true
      });
      return result.result.value;
    }
  }
}
