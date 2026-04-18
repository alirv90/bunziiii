import { newQuickJSAsyncWASMModule } from "quickjs-emscripten";
import variant from "@jitl/quickjs-ng-wasmfile-release-asyncify";
import type {
  QuickJSAsyncContext,
  QuickJSAsyncWASMModule,
} from "quickjs-emscripten-core";
import { SandboxError, type SandboxRuntimeOptions } from "./types";

const GUEST_SHIM = `
  globalThis.__sbx_fns = Object.create(null);
  globalThis.__sbx_register = (id, fn) => { globalThis.__sbx_fns[id] = fn; };
  globalThis.__sbx_invoke = async (id, ctxJson) => {
    const ctx = JSON.parse(ctxJson);
    ctx.suspend = async (payload) => ({ __sbx_suspend__: true, payload: payload === undefined ? null : payload });
    const fn = globalThis.__sbx_fns[id];
    if (typeof fn !== "function") throw new Error("no sandbox function registered for id: " + id);
    const result = await fn(ctx);
    return JSON.stringify(result === undefined ? null : result);
  };
`;

export class SandboxRuntime {
  private module?: QuickJSAsyncWASMModule;
  private context?: QuickJSAsyncContext;
  private timeoutMs: number;
  private memoryBytes: number;
  private counter = 0;

  constructor(opts: SandboxRuntimeOptions = {}) {
    this.timeoutMs = opts.stepTimeoutMs ?? 5000;
    this.memoryBytes = opts.memoryLimitBytes ?? 64 * 1024 * 1024;
  }

  async init(): Promise<void> {
    this.module = await newQuickJSAsyncWASMModule(variant);
    this.context = await this.module.newContext();
    this.context.runtime.setMemoryLimit(this.memoryBytes);
    this.evalOrThrow(GUEST_SHIM, "<shim>", "runtime");
  }

  prelude(source: string): void {
    if (!this.context) throw new SandboxError("bridge", "runtime not initialised");
    this.evalOrThrow(source, "prelude.js", "syntax");
  }

  registerFunction(functionSource: string): string {
    if (!this.context) throw new SandboxError("bridge", "runtime not initialised");
    const id = `fn_${++this.counter}`;
    const code = `globalThis.__sbx_register(${JSON.stringify(id)}, (${functionSource}));`;
    this.evalOrThrow(code, `register(${id}).js`, "syntax");
    return id;
  }

  async invokeFn(fnId: string, ctxObj: unknown): Promise<unknown> {
    if (!this.context) throw new SandboxError("bridge", "runtime not initialised");
    const ctx = this.context;

    const startTime = Date.now();
    ctx.runtime.setInterruptHandler(() => Date.now() - startTime > this.timeoutMs);

    const ctxJsonStr = JSON.stringify(ctxObj ?? {});
    const idH = ctx.newString(fnId);
    const ctxH = ctx.newString(ctxJsonStr);
    const invokeH = ctx.getProp(ctx.global, "__sbx_invoke");

    let promiseH;
    try {
      const callR = ctx.callFunction(invokeH, ctx.undefined, idH, ctxH);
      promiseH = ctx.unwrapResult(callR);
    } catch (e) {
      ctx.runtime.removeInterruptHandler();
      const msg = (e as Error).message;
      if (msg.includes("interrupt")) throw new SandboxError("timeout", `timeout in ${fnId}`);
      throw new SandboxError("runtime", `${fnId}: ${msg}`);
    } finally {
      idH.dispose();
      ctxH.dispose();
      invokeH.dispose();
    }

    try {
      ctx.runtime.executePendingJobs();
      const state = ctx.getPromiseState(promiseH);
      if (state.type === "pending") {
        throw new SandboxError(
          "runtime",
          `${fnId}: promise still pending after job drain (guest awaited a host callback with no resolver)`,
        );
      }
      const outH = ctx.unwrapResult(state);
      const out = ctx.getString(outH);
      outH.dispose();
      ctx.runtime.removeInterruptHandler();
      return JSON.parse(out);
    } catch (e) {
      ctx.runtime.removeInterruptHandler();
      if (e instanceof SandboxError) throw e;
      const msg = (e as Error).message;
      if (msg.includes("interrupt")) throw new SandboxError("timeout", `timeout in ${fnId}`);
      throw new SandboxError("runtime", `${fnId}: ${msg}`);
    } finally {
      promiseH.dispose();
    }
  }

  dispose(): void {
    this.context?.dispose();
    this.context = undefined;
    this.module = undefined;
  }

  private evalOrThrow(code: string, filename: string, kind: "syntax" | "runtime"): void {
    const ctx = this.context!;
    let r;
    try {
      r = ctx.evalCode(code, filename);
    } catch (e) {
      throw new SandboxError(kind, (e as Error).message);
    }
    try {
      const h = ctx.unwrapResult(r);
      h.dispose();
    } catch (e) {
      throw new SandboxError("runtime", (e as Error).message);
    }
  }
}
