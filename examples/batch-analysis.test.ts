import { test, expect } from "bun:test";
import { mastra } from "./batch-analysis";

test("batch analysis produces stats + listing report", async () => {
  const wf = mastra.getWorkflow("batchAnalysisWorkflow");
  const run = await wf.createRun();
  const result = await run.start({
    inputData: { values: [0, 1, 2, 3, 5, 8, 13, 15, 21, 97] },
  });
  expect(result.status).toBe("success");
  if (result.status !== "success") return;
  expect(result.result.report).toBe(
    [
      "Analyzed 10 values (sum=165)",
      "  primes=5, composites=3, trivial=2",
      "Details:",
      "  - 0: prime=false, fizz=FizzBuzz, fact=1",
      "  - 1: prime=false, fizz=1, fact=1",
      "  - 2: prime=true, fizz=2, fact=2",
      "  - 3: prime=true, fizz=Fizz, fact=6",
      "  - 5: prime=true, fizz=Buzz, fact=120",
      "  - 8: prime=false, fizz=8, fact=40320",
      "  - 13: prime=true, fizz=13",
      "  - 15: prime=false, fizz=FizzBuzz",
      "  - 21: prime=false, fizz=Fizz",
      "  - 97: prime=true, fizz=97",
    ].join("\n"),
  );
});
