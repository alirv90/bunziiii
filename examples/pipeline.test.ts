import { test, expect } from "bun:test";
import { mastra } from "./pipeline";

test("pipeline runs nested workflow per value and summarizes", async () => {
  const wf = mastra.getWorkflow("pipelineWorkflow");
  const run = await wf.createRun();
  const result = await run.start({
    inputData: { values: [3, 5, 7, 10, 15, 23] },
  });
  expect(result.status).toBe("success");
  if (result.status !== "success") return;
  expect(result.result.report).toBe(
    [
      "Processed 6 values via nested workflow:",
      "  - 3 [prime, fizz, fact=6]",
      "  - 5 [prime, buzz, fact=120]",
      "  - 7 [prime, fact=5040]",
      "  - 10 [buzz, fact=3628800]",
      "  - 15 [fizzbuzz]",
      "  - 23 [prime]",
    ].join("\n"),
  );
});
