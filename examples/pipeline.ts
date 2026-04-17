import { Mastra } from "@mastra/core";
import { createWorkflow, createStep } from "@mastra/core/workflows";
import { LibSQLStore } from "@mastra/libsql";
import { z } from "zod";
import { factorial, fizzbuzz, isPrime } from "../index";

// --- Nested workflow: runs a full pipeline on a single value ---

const analyze = createStep({
  id: "analyze",
  inputSchema: z.object({ value: z.number().int() }),
  outputSchema: z.object({
    value: z.number().int(),
    prime: z.boolean(),
    fizzbuzz: z.string(),
    factorial: z.number().optional(),
  }),
  execute: async ({ inputData: { value } }) => ({
    value,
    prime: isPrime(value),
    fizzbuzz: fizzbuzz(value),
    factorial: value >= 0 && value <= 12 ? factorial(value) : undefined,
  }),
});

const describe = createStep({
  id: "describe",
  inputSchema: z.object({
    value: z.number().int(),
    prime: z.boolean(),
    fizzbuzz: z.string(),
    factorial: z.number().optional(),
  }),
  outputSchema: z.object({
    value: z.number().int(),
    description: z.string(),
  }),
  execute: async ({ inputData }) => {
    const tags: string[] = [];
    if (inputData.prime) tags.push("prime");
    if (inputData.fizzbuzz === "FizzBuzz") tags.push("fizzbuzz");
    else if (inputData.fizzbuzz === "Fizz") tags.push("fizz");
    else if (inputData.fizzbuzz === "Buzz") tags.push("buzz");
    if (inputData.factorial !== undefined) tags.push(`fact=${inputData.factorial}`);
    return {
      value: inputData.value,
      description: `${inputData.value}${tags.length ? ` [${tags.join(", ")}]` : ""}`,
    };
  },
});

export const classifyOneWorkflow = createWorkflow({
  id: "classify-one",
  inputSchema: z.object({ value: z.number().int() }),
  outputSchema: z.object({
    value: z.number().int(),
    description: z.string(),
  }),
})
  .then(analyze)
  .then(describe)
  .commit();

// --- Parent workflow: uses classifyOneWorkflow as a step inside .foreach() ---

const prepare = createStep({
  id: "prepare",
  inputSchema: z.object({ values: z.array(z.number().int()) }),
  outputSchema: z.array(z.object({ value: z.number().int() })),
  execute: async ({ inputData }) => inputData.values.map((v) => ({ value: v })),
});

const summarize = createStep({
  id: "summarize",
  inputSchema: z.array(
    z.object({ value: z.number().int(), description: z.string() }),
  ),
  outputSchema: z.object({ report: z.string() }),
  execute: async ({ inputData }) => ({
    report: [
      `Processed ${inputData.length} values via nested workflow:`,
      ...inputData.map((r) => `  - ${r.description}`),
    ].join("\n"),
  }),
});

export const pipelineWorkflow = createWorkflow({
  id: "pipeline",
  inputSchema: z.object({ values: z.array(z.number().int()) }),
  outputSchema: z.object({ report: z.string() }),
})
  .then(prepare)
  .foreach(classifyOneWorkflow, { concurrency: 2 })
  .then(summarize)
  .commit();

export const mastra = new Mastra({
  workflows: { pipelineWorkflow, classifyOneWorkflow },
  storage: new LibSQLStore({ id: "pipeline-store", url: ":memory:" }),
});

if (import.meta.main) {
  const wf = mastra.getWorkflow("pipelineWorkflow");
  const run = await wf.createRun();
  const result = await run.start({
    inputData: { values: [3, 5, 7, 10, 15, 23] },
  });
  console.log("status:", result.status);
  if (result.status === "success") {
    console.log(result.result.report);
  } else {
    console.log("unexpected:", result);
  }
}
