import type { WebContents } from "electron";

export class CdpClient {
  private attached = false;

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
    // Get the global execution context
    const ctx = await this.send<{ result: { objectId: string } }>("Runtime.evaluate", {
      expression: "globalThis",
      returnByValue: false
    });

    const callArguments = args.map((arg) => {
      if (arg === undefined) return { unserializableValue: "undefined" };
      return { value: arg };
    });

    const result = await this.send<{ result: { value: T } }>("Runtime.callFunctionOn", {
      functionDeclaration,
      objectId: ctx.result.objectId,
      arguments: callArguments,
      returnByValue: true,
      awaitPromise: true
    });

    return result.result.value;
  }
}
