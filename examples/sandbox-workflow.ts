import { Mastra } from "@mastra/core";
import { LibSQLStore } from "@mastra/libsql";
import { z } from "zod";
import {
  SandboxRuntime,
  createSandboxStep,
  createSandboxWorkflow,
} from "../src/sandbox";

const runtime = new SandboxRuntime({ stepTimeoutMs: 5_000 });
await runtime.init();

// Utilities the sandboxed steps can reference. Closures aren't captured
// when a step's source is lifted into QuickJS, so shared helpers go here.
runtime.prelude(`
  function isPrime(n) {
    if (n < 2) return false;
    for (let i = 2; i <= Math.sqrt(n); i++) if (n % i === 0) return false;
    return true;
  }
`);

const classify = createSandboxStep({
  id: "classify",
  inputSchema: z.object({ value: z.number().int() }),
  outputSchema: z.object({
    value: z.number().int(),
    category: z.enum(["small", "prime", "composite"]),
  }),
  runtime,
  execute: async ({ inputData: { value } }: any) => {
    if (value <= 10) return { value, category: "small" };
    return { value, category: isPrime(value) ? "prime" : "composite" };
  },
});

const handledShape = z.object({
  category: z.enum(["small", "prime", "composite"]),
  value: z.number().int(),
  requiresApproval: z.boolean(),
  summary: z.string(),
});
const branchInput = z.object({
  value: z.number().int(),
  category: z.enum(["small", "prime", "composite"]),
});

const handleSmall = createSandboxStep({
  id: "handle-small",
  inputSchema: branchInput,
  outputSchema: handledShape,
  runtime,
  execute: async ({ inputData: { value } }: any) => ({
    category: "small",
    value,
    requiresApproval: false,
    summary: `Trivial small value ${value}; auto-approved.`,
  }),
});

const handlePrime = createSandboxStep({
  id: "handle-prime",
  inputSchema: branchInput,
  outputSchema: handledShape,
  runtime,
  execute: async ({ inputData: { value } }: any) => ({
    category: "prime",
    value,
    requiresApproval: true,
    summary: `Large prime ${value} flagged for human review.`,
  }),
});

const handleComposite = createSandboxStep({
  id: "handle-composite",
  inputSchema: branchInput,
  outputSchema: handledShape,
  runtime,
  execute: async ({ inputData: { value } }: any) => ({
    category: "composite",
    value,
    requiresApproval: false,
    summary: `Composite ${value}; processed automatically.`,
  }),
});

const approvalGate = createSandboxStep({
  id: "approval-gate",
  inputSchema: handledShape,
  outputSchema: z.object({
    category: z.enum(["small", "prime", "composite"]),
    value: z.number().int(),
    summary: z.string(),
    approved: z.boolean(),
  }),
  suspendSchema: z.object({
    reason: z.string(),
    candidate: z.number().int(),
  }),
  resumeSchema: z.object({
    approved: z.boolean(),
    reviewer: z.string(),
  }),
  runtime,
  execute: async ({ inputData, resumeData, suspendData, suspend }: any) => {
    if (!inputData.requiresApproval) {
      return {
        category: inputData.category,
        value: inputData.value,
        summary: inputData.summary,
        approved: true,
      };
    }
    if (!resumeData) {
      return await suspend({
        reason: `Awaiting human approval for ${inputData.category} ${inputData.value}`,
        candidate: inputData.value,
      });
    }
    const reason = suspendData && suspendData.reason ? suspendData.reason : "n/a";
    return {
      category: inputData.category,
      value: inputData.value,
      summary: `${inputData.summary} | reviewer=${resumeData.reviewer} | suspendReason=${reason}`,
      approved: resumeData.approved,
    };
  },
});

const report = createSandboxStep({
  id: "report",
  inputSchema: z.object({
    category: z.enum(["small", "prime", "composite"]),
    value: z.number().int(),
    summary: z.string(),
    approved: z.boolean(),
  }),
  outputSchema: z.object({ verdict: z.string() }),
  runtime,
  execute: async ({ inputData }: any) => ({
    verdict: `[${String(inputData.category).toUpperCase()}] ${inputData.value} \u2192 approved=${inputData.approved}: ${inputData.summary}`,
  }),
});

const numberReviewSandbox = createSandboxWorkflow({
  id: "number-review-sandbox",
  inputSchema: z.object({ value: z.number().int() }),
  outputSchema: z.object({ verdict: z.string() }),
  runtime,
})
  .then(classify)
  .branch([
    [async ({ inputData: { category } }: any) => category === "small", handleSmall],
    [async ({ inputData: { category } }: any) => category === "prime", handlePrime],
    [async ({ inputData: { category } }: any) => category === "composite", handleComposite],
  ])
  .map(async ({ inputData }: any) => {
    const out =
      inputData["handle-small"] ??
      inputData["handle-prime"] ??
      inputData["handle-composite"];
    if (!out) throw new Error("No branch produced output");
    return out;
  })
  .then(approvalGate)
  .then(report)
  .commit();

const mastra = new Mastra({
  workflows: { numberReviewSandbox },
  storage: new LibSQLStore({ id: "sbx-store", url: ":memory:" }),
});

async function runOnce(label: string, value: number) {
  console.log(`\n=== ${label} (input value=${value}) ===`);
  const wf = mastra.getWorkflow("numberReviewSandbox");
  const run = await wf.createRun();
  const result = await run.start({ inputData: { value } });
  console.log("status:", result.status);

  if (result.status === "success") {
    console.log("result:", result.result);
    return;
  }
  if (result.status === "suspended") {
    console.log("suspended at:", result.suspended);
    console.log("suspendPayload:", result.suspendPayload);
    console.log("\u2192 resuming with reviewer=alice, approved=true");
    const resumed = await run.resume({
      step: "approval-gate",
      resumeData: { approved: true, reviewer: "alice" },
    });
    console.log("post-resume status:", resumed.status);
    if (resumed.status === "success") console.log("result:", resumed.result);
    else console.log("unexpected:", resumed);
    return;
  }
  console.log("unexpected:", result);
}

try {
  await runOnce("Run 1: small (auto-approved)", 7);
  await runOnce("Run 2: composite (auto-approved)", 21);
  await runOnce("Run 3: prime (suspend \u2192 resume)", 97);
} finally {
  runtime.dispose();
}
