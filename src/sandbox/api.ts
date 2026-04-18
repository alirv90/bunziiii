import { createStep, createWorkflow } from "@mastra/core/workflows";
import type { z } from "zod";
import type { SandboxRuntime } from "./runtime";
import type { BuildOp, StepSchemas } from "./types";
import { SandboxError } from "./types";

export interface SbxWorkflowParams {
  id: string;
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodTypeAny;
  stepSchemas: Record<string, StepSchemas>;
  runtime: SandboxRuntime;
  ops: BuildOp[];
}

function makeSbxStep(
  stepId: string,
  schemas: StepSchemas,
  runtime: SandboxRuntime,
) {
  return createStep({
    id: stepId,
    inputSchema: schemas.inputSchema as any,
    outputSchema: schemas.outputSchema as any,
    suspendSchema: schemas.suspendSchema as any,
    resumeSchema: schemas.resumeSchema as any,
    execute: async ({ inputData, resumeData, suspendData, suspend }) => {
      const ctxObj = {
        inputData,
        resumeData: resumeData ?? null,
        suspendData: suspendData ?? null,
      };
      const out = (await runtime.invoke("steps", stepId, ctxObj)) as any;
      if (out && typeof out === "object" && out.__sbx_suspend__) {
        return (await suspend(out.payload ?? undefined)) as any;
      }
      return out;
    },
  });
}

export function sbxCreateWorkflow(params: SbxWorkflowParams) {
  const { stepSchemas, runtime, ops } = params;

  const wf = createWorkflow({
    id: params.id,
    inputSchema: params.inputSchema as any,
    outputSchema: params.outputSchema as any,
  });

  let cur: any = wf;
  for (const op of ops) {
    if (op.type === "step") {
      const s = stepSchemas[op.name];
      if (!s) throw new SandboxError("bridge", `No schema for step '${op.name}'`);
      cur = cur.then(makeSbxStep(op.name, s, runtime));
    } else if (op.type === "map") {
      const mapName = op.name;
      cur = cur.map(async ({ inputData }: any) => {
        return (await runtime.invoke("maps", mapName, { inputData })) as any;
      });
    } else if (op.type === "branch") {
      const pairs = op.pairs.map(([condName, stepName]) => {
        const s = stepSchemas[stepName];
        if (!s) throw new SandboxError("bridge", `No schema for step '${stepName}'`);
        const cond = async ({ inputData }: any) => {
          return !!(await runtime.invoke("conditions", condName, { inputData }));
        };
        return [cond, makeSbxStep(stepName, s, runtime)] as const;
      });
      cur = cur.branch(pairs as any);
    } else {
      throw new SandboxError("bridge", `Unknown op type: ${(op as any).type}`);
    }
  }
  return cur.commit();
}
