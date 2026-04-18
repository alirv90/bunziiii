// User-authored workflow logic. This entire file runs inside a QuickJS
// sandbox — no access to `process`, `Bun`, `require`, or the host network.
// It self-registers its step/map/condition/definition bundle via the shim.

function isPrime(n) {
  if (n < 2) return false;
  for (let i = 2; i <= Math.sqrt(n); i++) {
    if (n % i === 0) return false;
  }
  return true;
}

globalThis.__sbx_register({
  steps: {
    classify: async ({ inputData }) => {
      const { value } = inputData;
      if (value <= 10) return { value, category: "small" };
      return { value, category: isPrime(value) ? "prime" : "composite" };
    },
    handleSmall: async ({ inputData }) => ({
      category: "small",
      value: inputData.value,
      requiresApproval: false,
      summary: `Trivial small value ${inputData.value}; auto-approved.`,
    }),
    handlePrime: async ({ inputData }) => ({
      category: "prime",
      value: inputData.value,
      requiresApproval: true,
      summary: `Large prime ${inputData.value} flagged for human review.`,
    }),
    handleComposite: async ({ inputData }) => ({
      category: "composite",
      value: inputData.value,
      requiresApproval: false,
      summary: `Composite ${inputData.value}; processed automatically.`,
    }),
    approvalGate: async ({ inputData, resumeData, suspendData, suspend }) => {
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
    report: async ({ inputData }) => ({
      verdict: `[${String(inputData.category).toUpperCase()}] ${inputData.value} \u2192 approved=${inputData.approved}: ${inputData.summary}`,
    }),
  },
  maps: {
    collapseBranch: async ({ inputData }) => {
      const out = inputData["handleSmall"] || inputData["handlePrime"] || inputData["handleComposite"];
      if (!out) throw new Error("No branch produced output");
      return out;
    },
  },
  conditions: {
    isSmall: async ({ inputData }) => inputData.category === "small",
    isPrimeCat: async ({ inputData }) => inputData.category === "prime",
    isComposite: async ({ inputData }) => inputData.category === "composite",
  },
  definition: (h) => {
    h.step("classify")
     .branch([
       ["isSmall", "handleSmall"],
       ["isPrimeCat", "handlePrime"],
       ["isComposite", "handleComposite"],
     ])
     .map("collapseBranch")
     .step("approvalGate")
     .step("report");
  },
});
