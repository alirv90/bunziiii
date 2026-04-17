import { Mastra } from "@mastra/core";
import { createWorkflow, createStep } from "@mastra/core/workflows";
import { LibSQLStore } from "@mastra/libsql";
import { z } from "zod";
import { factorial, fizzbuzz, isPrime } from "../index";

const analyzedShape = z.object({
  value: z.number().int(),
  prime: z.boolean(),
  fizzbuzz: z.string(),
  factorial: z.number().optional(),
});

const prepare = createStep({
  id: "prepare",
  inputSchema: z.object({ values: z.array(z.number().int()) }),
  outputSchema: z.array(z.object({ value: z.number().int() })),
  execute: async ({ inputData }) => inputData.values.map((v) => ({ value: v })),
});

const analyzeItem = createStep({
  id: "analyze-item",
  inputSchema: z.object({ value: z.number().int() }),
  outputSchema: analyzedShape,
  execute: async ({ inputData: { value } }) => ({
    value,
    prime: isPrime(value),
    fizzbuzz: fizzbuzz(value),
    factorial: value >= 0 && value <= 12 ? factorial(value) : undefined,
  }),
});

const statsStep = createStep({
  id: "stats",
  inputSchema: z.object({ items: z.array(analyzedShape) }),
  outputSchema: z.object({
    count: z.number(),
    primes: z.number(),
    composites: z.number(),
    trivial: z.number(),
    sum: z.number(),
  }),
  execute: async ({ inputData: { items } }) => ({
    count: items.length,
    primes: items.filter((i) => i.prime).length,
    composites: items.filter((i) => !i.prime && i.value > 1).length,
    trivial: items.filter((i) => i.value <= 1).length,
    sum: items.reduce((s, i) => s + i.value, 0),
  }),
});

const listingStep = createStep({
  id: "listing",
  inputSchema: z.object({ items: z.array(analyzedShape) }),
  outputSchema: z.object({ lines: z.array(z.string()) }),
  execute: async ({ inputData: { items } }) => ({
    lines: items.map((i) => {
      const fact = i.factorial !== undefined ? `, fact=${i.factorial}` : "";
      return `${i.value}: prime=${i.prime}, fizz=${i.fizzbuzz}${fact}`;
    }),
  }),
});

const reportStep = createStep({
  id: "report",
  inputSchema: z.object({
    stats: z.object({
      count: z.number(),
      primes: z.number(),
      composites: z.number(),
      trivial: z.number(),
      sum: z.number(),
    }),
    listing: z.object({ lines: z.array(z.string()) }),
  }),
  outputSchema: z.object({ report: z.string() }),
  execute: async ({ inputData: { stats, listing } }) => ({
    report: [
      `Analyzed ${stats.count} values (sum=${stats.sum})`,
      `  primes=${stats.primes}, composites=${stats.composites}, trivial=${stats.trivial}`,
      "Details:",
      ...listing.lines.map((l) => `  - ${l}`),
    ].join("\n"),
  }),
});

export const batchAnalysisWorkflow = createWorkflow({
  id: "batch-analysis",
  inputSchema: z.object({ values: z.array(z.number().int()) }),
  outputSchema: z.object({ report: z.string() }),
})
  .then(prepare)
  .foreach(analyzeItem, { concurrency: 3 })
  .map(async ({ inputData }: { inputData: z.infer<typeof analyzedShape>[] }) => ({
    items: inputData,
  }))
  .parallel([statsStep, listingStep])
  .then(reportStep)
  .commit();

export const mastra = new Mastra({
  workflows: { batchAnalysisWorkflow },
  storage: new LibSQLStore({ id: "batch-store", url: ":memory:" }),
});

if (import.meta.main) {
  const wf = mastra.getWorkflow("batchAnalysisWorkflow");
  const run = await wf.createRun();
  const result = await run.start({
    inputData: { values: [0, 1, 2, 3, 5, 8, 13, 15, 21, 97] },
  });
  console.log("status:", result.status);
  if (result.status === "success") {
    console.log(result.result.report);
  } else {
    console.log("unexpected:", result);
  }
}
