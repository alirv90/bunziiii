import { test, expect, afterAll } from "bun:test";
import { mastra, runtime } from "./sandbox-workflow";

afterAll(() => {
  runtime.dispose();
});

async function runVerdict(value: number) {
  const wf = mastra.getWorkflow("numberReviewSandbox");
  const run = await wf.createRun();
  const result = await run.start({ inputData: { value } });
  if (result.status === "success") {
    return { status: "success" as const, verdict: result.result.verdict };
  }
  if (result.status === "suspended") {
    return {
      status: "suspended" as const,
      suspended: result.suspended,
      suspendPayload: result.suspendPayload,
      resume: async () => {
        const r = await run.resume({
          step: "approval-gate",
          resumeData: { approved: true, reviewer: "alice" },
        });
        if (r.status !== "success") throw new Error(`resume status=${r.status}`);
        return r.result.verdict;
      },
    };
  }
  throw new Error(`unexpected status=${result.status}`);
}

test("sandbox: small value is auto-approved", async () => {
  const r = await runVerdict(7);
  expect(r.status).toBe("success");
  if (r.status === "success") {
    expect(r.verdict).toBe(
      "[SMALL] 7 → approved=true: Trivial small value 7; auto-approved.",
    );
  }
});

test("sandbox: composite > 10 is auto-approved", async () => {
  const r = await runVerdict(21);
  expect(r.status).toBe("success");
  if (r.status === "success") {
    expect(r.verdict).toBe(
      "[COMPOSITE] 21 → approved=true: Composite 21; processed automatically.",
    );
  }
});

test("sandbox: prime > 10 suspends and resumes with reviewer", async () => {
  const r = await runVerdict(97);
  expect(r.status).toBe("suspended");
  if (r.status !== "suspended") return;
  expect(r.suspended).toEqual([["approval-gate"]]);
  expect(r.suspendPayload).toEqual({
    "approval-gate": {
      reason: "Awaiting human approval for prime 97",
      candidate: 97,
    },
  });
  const verdict = await r.resume();
  expect(verdict).toBe(
    "[PRIME] 97 → approved=true: Large prime 97 flagged for human review. | reviewer=alice | suspendReason=Awaiting human approval for prime 97",
  );
});
