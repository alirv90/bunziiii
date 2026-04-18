import { newQuickJSAsyncWASMModule } from "quickjs-emscripten";
import variant from "@jitl/quickjs-ng-wasmfile-release-asyncify";
import type {
  QuickJSAsyncContext,
  QuickJSAsyncWASMModule,
} from "quickjs-emscripten-core";
import { SandboxError, type BuildOp, type SandboxRuntimeOptions } from "./types";

const GUEST_SHIM = `
  globalThis.__sbx_module = null;
  globalThis.__sbx_register = (m) => { globalThis.__sbx_module = m; };
  globalThis.__sbx_invoke = async (kind, name, ctxJson) => {
    const ctx = JSON.parse(ctxJson);
    ctx.suspend = async (payload) => ({ __sbx_suspend__: true, payload: payload === undefined ? null : payload });
    const m = globalThis.__sbx_module;
    if (!m) throw new Error("sandbox module not loaded");
    const bucket = m[kind];
    if (!bucket) throw new Error("unknown bucket: " + kind);
    const fn = bucket[name];
    if (typeof fn !== "function") throw new Error("no " + kind + "." + name);
    const result = await fn(ctx);
    return JSON.stringify(result === undefined ? null : result);
  };
  globalThis.__sbx_build = () => {
    const ops = [];
    const h = {
      step: (n) => { ops.push({ type: "step", name: n }); return h; },
      map: (n) => { ops.push({ type: "map", name: n }); return h; },
      branch: (pairs) => { ops.push({ type: "branch", pairs }); return h; },
    };
    const m = globalThis.__sbx_module;
    if (!m || typeof m.definition !== "function") throw new Error("module has no definition()");
    m.definition(h);
    return JSON.stringify(ops);
  };
`;

export class SandboxRuntime {
  private module?: QuickJSAsyncWASMModule;
  private context?: QuickJSAsyncContext;
  private loaded = false;
  private timeoutMs: number;
  private memoryBytes: number;

  constructor(opts: SandboxRuntimeOptions = {}) {
    this.timeoutMs = opts.stepTimeoutMs ?? 5000;
    this.memoryBytes = opts.memoryLimitBytes ?? 64 * 1024 * 1024;
  }

  async init(): Promise<void> {
    this.module = await newQuickJSAsyncWASMModule(variant);
    this.context = await this.module.newContext();
    this.context.runtime.setMemoryLimit(this.memoryBytes);
    const r = this.context.evalCode(GUEST_SHIM);
    const h = this.context.unwrapResult(r);
    h.dispose();
  }

  async loadModule(source: string): Promise<void> {
    if (!this.context) throw new SandboxError("bridge", "runtime not initialised");
    let r;
    try {
      r = this.context.evalCode(source, "user-module.js");
    } catch (e) {
      throw new SandboxError("syntax", (e as Error).message);
    }
    try {
      const h = this.context.unwrapResult(r);
      h.dispose();
    } catch (e) {
      throw new SandboxError("runtime", (e as Error).message);
    }
    this.loaded = true;
  }

  async buildGraph(): Promise<BuildOp[]> {
    if (!this.context) throw new SandboxError("bridge", "runtime not initialised");
    if (!this.loaded) throw new SandboxError("bridge", "no module loaded");
    const ctx = this.context;
    const buildH = ctx.getProp(ctx.global, "__sbx_build");
    try {
      const r = ctx.callFunction(buildH, ctx.undefined);
      const outH = ctx.unwrapResult(r);
      const out = ctx.getString(outH);
      outH.dispose();
      return JSON.parse(out) as BuildOp[];
    } finally {
      buildH.dispose();
    }
  }

  async invoke(kind: "steps" | "maps" | "conditions", name: string, ctxObj: unknown): Promise<unknown> {
    if (!this.context) throw new SandboxError("bridge", "runtime not initialised");
    const ctx = this.context;

    const startTime = Date.now();
    ctx.runtime.setInterruptHandler(() => Date.now() - startTime > this.timeoutMs);

    const ctxJsonStr = JSON.stringify(ctxObj ?? {});
    const kindH = ctx.newString(kind);
    const nameH = ctx.newString(name);
    const ctxH = ctx.newString(ctxJsonStr);
    const invokeH = ctx.getProp(ctx.global, "__sbx_invoke");

    let promiseH;
    try {
      const callR = ctx.callFunction(invokeH, ctx.undefined, kindH, nameH, ctxH);
      promiseH = ctx.unwrapResult(callR);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("interrupt")) throw new SandboxError("timeout", `timeout in ${kind}.${name}`);
      throw new SandboxError("runtime", `${kind}.${name}: ${msg}`);
    } finally {
      kindH.dispose();
      nameH.dispose();
      ctxH.dispose();
      invokeH.dispose();
    }

    try {
      ctx.runtime.executePendingJobs();
      const state = ctx.getPromiseState(promiseH);
      if (state.type === "pending") {
        throw new SandboxError("runtime", `${kind}.${name}: promise still pending after job drain (guest awaited a host callback with no resolver)`);
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
      if (msg.includes("interrupt")) throw new SandboxError("timeout", `timeout in ${kind}.${name}`);
      throw new SandboxError("runtime", `${kind}.${name}: ${msg}`);
    } finally {
      promiseH.dispose();
    }
  }

  dispose(): void {
    this.context?.dispose();
    this.context = undefined;
    this.module = undefined;
    this.loaded = false;
  }
}
