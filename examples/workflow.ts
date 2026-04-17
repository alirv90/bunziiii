import { Mastra } from "@mastra/core";
import { createWorkflow, createStep } from "@mastra/core/workflows";
import { LibSQLStore } from "@mastra/libsql";
import { z } from "zod";
import { isPrime } from "../index";

// Step 1: classify the incoming value
const classify = createStep({
  id: "classify",
  inputSchema: z.object({ value: z.number().int() }),
  outputSchema: z.object({
    value: z.number().int(),
    category: z.enum(["small", "prime", "composite"]),
  }),
  execute: async ({ inputData: { value } }) => {
    if (value <= 10) return { value, category: "small" as const };
    return { value, category: isPrime(value) ? ("prime" as const) : ("composite" as const) };
  },
});

// Branch step output shape (must match across all branches)
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

const handleSmall = createStep({
  id: "handle-small",
  inputSchema: branchInput,
  outputSchema: handledShape,
  execute: async ({ inputData: { value } }) => ({
    category: "small" as const,
    value,
    requiresApproval: false,
    summary: `Trivial small value ${value}; auto-approved.`,
  }),
});

const handlePrime = createStep({
  id: "handle-prime",
  inputSchema: branchInput,
  outputSchema: handledShape,
  execute: async ({ inputData: { value } }) => ({
    category: "prime" as const,
    value,
    requiresApproval: true,
    summary: `Large prime ${value} flagged for human review.`,
  }),
});

const handleComposite = createStep({
  id: "handle-composite",
  inputSchema: branchInput,
  outputSchema: handledShape,
  execute: async ({ inputData: { value } }) => ({
    category: "composite" as const,
    value,
    requiresApproval: false,
    summary: `Composite ${value}; processed automatically.`,
  }),
});

// Step 2: human-in-the-loop approval gate (suspend/resume)
const approvalGate = createStep({
  id: "approval-gate",
  inputSchema: handledShape,
  outputSchema: z.object({
    category: z.enum(["small", "prime", "composite"]),
    value: z.number().int(),
    summary: z.string(),
    approved: z.boolean(),
  }),
  resumeSchema: z.object({
    approved: z.boolean(),
    reviewer: z.string(),
  }),
  suspendSchema: z.object({
    reason: z.string(),
    candidate: z.number().int(),
  }),
  execute: async ({ inputData, resumeData, suspend, suspendData }) => {
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
    return {
      category: inputData.category,
      value: inputData.value,
      summary: `${inputData.summary} | reviewer=${resumeData.reviewer} | suspendReason=${suspendData?.reason ?? "n/a"}`,
      approved: resumeData.approved,
    };
  },
});

// Step 3: final report
const report = createStep({
  id: "report",
  inputSchema: z.object({
    category: z.enum(["small", "prime", "composite"]),
    value: z.number().int(),
    summary: z.string(),
    approved: z.boolean(),
  }),
  outputSchema: z.object({ verdict: z.string() }),
  execute: async ({ inputData }) => ({
    verdict: `[${inputData.category.toUpperCase()}] ${inputData.value} → approved=${inputData.approved}: ${inputData.summary}`,
  }),
});

// Workflow: classify -> branch(small | prime | composite) -> map -> approval -> report
export const numberReviewWorkflow = createWorkflow({
  id: "number-review",
  inputSchema: z.object({ value: z.number().int() }),
  outputSchema: z.object({ verdict: z.string() }),
})
  .then(classify)
  .branch([
    [async ({ inputData: { category } }) => category === "small", handleSmall],
    [async ({ inputData: { category } }) => category === "prime", handlePrime],
    [async ({ inputData: { category } }) => category === "composite", handleComposite],
  ])
  // Branch output is keyed by step id; collapse to the next step's expected shape
  .map(async ({ inputData }: { inputData: Record<string, z.infer<typeof handledShape> | undefined> }) => {
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

// Register the workflow with a Mastra instance so suspend/resume snapshots
// can be persisted (in-memory libSQL is enough for this demo).
export const mastra = new Mastra({
  workflows: { numberReviewWorkflow },
  storage: new LibSQLStore({ id: "demo-store", url: ":memory:" }),
});

async function runOnce(label: string, value: number) {
  console.log(`\n=== ${label} (input value=${value}) ===`);
  const wf = mastra.getWorkflow("numberReviewWorkflow");
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
    console.log("→ resuming with reviewer=alice, approved=true");
    const resumed = await run.resume({
      step: "approval-gate",
      resumeData: { approved: true, reviewer: "alice" },
    });
    console.log("post-resume status:", resumed.status);
    if (resumed.status === "success") console.log("result:", resumed.result);
    else console.log("unexpected status:", resumed);
    return;
  }

  console.log("unexpected status:", result);
}

if (import.meta.main) {
  await runOnce("Run 1: small value (auto-approved)", 7);
  await runOnce("Run 2: composite > 10 (auto-approved)", 21);
  await runOnce("Run 3: prime > 10 (suspend → resume)", 97);
}
