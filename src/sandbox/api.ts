import { createStep, createWorkflow } from "@mastra/core/workflows";
import type { z } from "zod";
import type { SandboxRuntime } from "./runtime";

type AnyFn = (...args: any[]) => any;

interface SandboxStepParams<
  TStepId extends string,
  TInput extends z.ZodTypeAny,
  TOutput extends z.ZodTypeAny,
  TSuspend extends z.ZodTypeAny | undefined = undefined,
  TResume extends z.ZodTypeAny | undefined = undefined,
> {
  id: TStepId;
  inputSchema: TInput;
  outputSchema: TOutput;
  suspendSchema?: TSuspend;
  resumeSchema?: TResume;
  execute: AnyFn;
  runtime: SandboxRuntime;
}

export function createSandboxStep<
  TStepId extends string,
  TInput extends z.ZodTypeAny,
  TOutput extends z.ZodTypeAny,
  TSuspend extends z.ZodTypeAny | undefined = undefined,
  TResume extends z.ZodTypeAny | undefined = undefined,
>(params: SandboxStepParams<TStepId, TInput, TOutput, TSuspend, TResume>) {
  const { runtime, execute, ...rest } = params;
  const fnId = runtime.registerFunction(execute.toString());

  return createStep({
    id: rest.id,
    inputSchema: rest.inputSchema as any,
    outputSchema: rest.outputSchema as any,
    suspendSchema: rest.suspendSchema as any,
    resumeSchema: rest.resumeSchema as any,
    execute: async ({ inputData, resumeData, suspendData, suspend }: any) => {
      const ctxObj = {
        inputData,
        resumeData: resumeData ?? null,
        suspendData: suspendData ?? null,
      };
      const out = (await runtime.invokeFn(fnId, ctxObj)) as any;
      if (out && typeof out === "object" && out.__sbx_suspend__) {
        return (await suspend(out.payload ?? undefined)) as any;
      }
      return out;
    },
  });
}

interface SandboxWorkflowParams<
  TId extends string,
  TInput extends z.ZodTypeAny,
  TOutput extends z.ZodTypeAny,
> {
  id: TId;
  inputSchema: TInput;
  outputSchema: TOutput;
  runtime: SandboxRuntime;
}

class SandboxWorkflowBuilder {
  constructor(private wf: any, private runtime: SandboxRuntime) {}

  then(step: any): this {
    this.wf = this.wf.then(step);
    return this;
  }

  map(fn: AnyFn): this {
    const fnId = this.runtime.registerFunction(fn.toString());
    const rt = this.runtime;
    this.wf = this.wf.map(async ({ inputData }: any) => {
      return (await rt.invokeFn(fnId, { inputData })) as any;
    });
    return this;
  }

  branch(pairs: Array<[AnyFn, any]>): this {
    const rt = this.runtime;
    const wrapped = pairs.map(([cond, step]) => {
      const fnId = rt.registerFunction(cond.toString());
      return [
        async ({ inputData }: any) =>
          !!(await rt.invokeFn(fnId, { inputData })),
        step,
      ] as const;
    });
    this.wf = this.wf.branch(wrapped as any);
    return this;
  }

  commit(): any {
    return this.wf.commit();
  }
}

export function createSandboxWorkflow<
  TId extends string,
  TInput extends z.ZodTypeAny,
  TOutput extends z.ZodTypeAny,
>(params: SandboxWorkflowParams<TId, TInput, TOutput>) {
  const wf = createWorkflow({
    id: params.id,
    inputSchema: params.inputSchema as any,
    outputSchema: params.outputSchema as any,
  });
  return new SandboxWorkflowBuilder(wf, params.runtime);
}
