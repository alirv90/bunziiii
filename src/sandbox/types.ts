import type { z } from "zod";

export interface SandboxRuntimeOptions {
  memoryLimitBytes?: number;
  stepTimeoutMs?: number;
}

export type BuildOp =
  | { type: "step"; name: string }
  | { type: "map"; name: string }
  | { type: "branch"; pairs: [string, string][] };

export interface StepSchemas {
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodTypeAny;
  suspendSchema?: z.ZodTypeAny;
  resumeSchema?: z.ZodTypeAny;
}

export class SandboxError extends Error {
  constructor(
    public kind: "syntax" | "runtime" | "timeout" | "oom" | "bridge",
    message: string,
    public guestStack?: string,
  ) {
    super(message);
    this.name = "SandboxError";
  }
}
