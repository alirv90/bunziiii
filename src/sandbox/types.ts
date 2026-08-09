export interface SandboxRuntimeOptions {
  memoryLimitBytes?: number;
  stepTimeoutMs?: number;
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
