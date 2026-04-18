import { Mastra } from "@mastra/core";
import { LibSQLStore } from "@mastra/libsql";
import { z } from "zod";
import { SandboxRuntime, sbxCreateWorkflow, type StepSchemas } from "../src/sandbox";

const category = z.enum(["small", "prime", "composite"]);
const classifyOut = z.object({ value: z.number().int(), category });
const handled = z.object({
  category,
  value: z.number().int(),
  requiresApproval: z.boolean(),
  summary: z.string(),
});
const approvalOut = z.object({
  category,
  value: z.number().int(),
  summary: z.string(),
  approved: z.boolean(),
});

const stepSchemas: Record<string, StepSchemas> = {
  classify: {
    inputSchema: z.object({ value: z.number().int() }),
    outputSchema: classifyOut,
  },
  handleSmall: { inputSchema: classifyOut, outputSchema: handled },
  handlePrime: { inputSchema: classifyOut, outputSchema: handled },
  handleComposite: { inputSchema: classifyOut, outputSchema: handled },
  approvalGate: {
    inputSchema: handled,
    outputSchema: approvalOut,
    suspendSchema: z.object({ reason: z.string(), candidate: z.number().int() }),
    resumeSchema: z.object({ approved: z.boolean(), reviewer: z.string() }),
  },
  report: {
    inputSchema: approvalOut,
    outputSchema: z.object({ verdict: z.string() }),
  },
};

const runtime = new SandboxRuntime({ stepTimeoutMs: 5_000 });
await runtime.init();

const source = await Bun.file(
  new URL("./sandbox-user-code.js", import.meta.url).pathname,
).text();
await runtime.loadModule(source);
const ops = await runtime.buildGraph();

const numberReviewSandbox = sbxCreateWorkflow({
  id: "number-review-sandbox",
  inputSchema: z.object({ value: z.number().int() }),
  outputSchema: z.object({ verdict: z.string() }),
  stepSchemas,
  runtime,
  ops,
});

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
      step: "approvalGate",
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
