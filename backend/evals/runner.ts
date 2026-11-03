
import { z } from "zod";

import { SystemMessage, HumanMessage } from "@langchain/core/messages";

import { GroqModel } from "../src/agent/model.ts";
import { TriageSchema, CATEGORIES } from "../src/agent/types.ts";
import { TRIAGE_SYSTEM, ticketBlock } from "../src/agent/prompts.ts";
import { config } from "../src/config.ts";

import { scoreTriage } from "./scorers/triage.scorer.ts";
import { judgeTriageSummary } from "./judges/triage.judges.ts";

import {
  readFile,
  writeFile,
  mkdir,
} from "node:fs/promises";

// 1. Evaluation dataset schema
const EvalCaseSchema = z.object({
  id: z.string(),

  input: z.object({
    from_email: z.string(),
    subject: z.string(),
    body: z.string(),
  }),

  expected: z.object({
    category: z.enum(CATEGORIES),
  }),

  tags: z.union([
    z.array(z.string()),
    z.string(),
  ]).optional(),
});

type EvalCase = z.infer<typeof EvalCaseSchema>;

// 2. Evaluation result type
type EvalResult = {
  id: string;
  expected: string;
  actual: string;
  summary?: string;
  confidence?: number;

  status: "PASS" | "FAIL" | "ERROR";

  accuracy?: number;
  faithfulness?: number;
  completeness?: number;

  judgeStatus: "OK" | "ERROR" | "NOT_RUN";

  judgeFeedback?: {
  accuracy: string;
  faithfulness: string;
  completeness: string;
};
};

// 3. Load and validate dataset
async function loadDataset(): Promise<EvalCase[]> {
  const file = await readFile(
    new URL("./datasets/triage.json", import.meta.url),
    "utf-8"
  );

  const parsed = z.array(EvalCaseSchema).safeParse(
    JSON.parse(file)
  );

  if (!parsed.success) {
    throw new Error(
      `Invalid evaluation dataset:\n${z.prettifyError(parsed.error)}`
    );
  }

  return parsed.data;
}

// 4. Run evaluation
async function runEvaluation() {
  const dataset = await loadDataset();

  // Temporarily use 5 cases to avoid rate limits.
  // Remove .slice(0, 5) when ready to evaluate all cases.
  const testCases = dataset.slice(0, 5);

  const model = new GroqModel(config.groqApiKey);

  const results: EvalResult[] = [];

  console.log(
    `\nRunning ${testCases.length} evaluation cases...\n`
  );

  for (const testCase of testCases) {
    console.log(`Evaluating ${testCase.id}...`);

    // Step 1: Run triage agent
    let prediction;

    try {
      const messages = [
        new SystemMessage(TRIAGE_SYSTEM),
        new HumanMessage(ticketBlock(testCase.input)),
      ];

      prediction = await model.structured(
        "triage",
        TriageSchema,
        messages
      );
    } catch (error) {
      console.error(
        `${testCase.id}: TRIAGE ERROR`,
        error
      );

      results.push({
        id: testCase.id,
        expected: testCase.expected.category,
        actual: "ERROR",
        status: "ERROR",
        judgeStatus: "NOT_RUN",
      });

      continue;
    }

    // Step 2: Deterministic evaluation
    const score = scoreTriage(
      testCase.expected.category,
      prediction.category
    );

    // Step 3: LLM-as-a-Judge evaluation
    try {
      const judgeResult = await judgeTriageSummary(
        model,
        testCase.input,
        prediction
      );

      results.push({
        id: testCase.id,
        expected: score.expected,
        actual: score.actual,

        summary: prediction.summary,
        confidence: prediction.confidence,

        status: score.passed ? "PASS" : "FAIL",

        accuracy: judgeResult.accuracy.score,
        faithfulness: judgeResult.faithfulness.score,
        completeness: judgeResult.completeness.score,

        judgeStatus: "OK",
        judgeFeedback: {
  accuracy: judgeResult.accuracy.reason,
  faithfulness: judgeResult.faithfulness.reason,
  completeness: judgeResult.completeness.reason,
},
      });

      console.log(
        `${testCase.id}: ${score.passed ? "PASS" : "FAIL"} | Judge: OK`
      );

    } catch (error) {
      console.error(
        `${testCase.id}: JUDGE ERROR`,
        error
      );

      // Preserve the successful triage prediction.
      results.push({
        id: testCase.id,
        expected: score.expected,
        actual: score.actual,

        summary: prediction.summary,
        confidence: prediction.confidence,

        status: score.passed ? "PASS" : "FAIL",
        judgeStatus: "ERROR",
      });
    }
  }

  // 5. Calculate deterministic metrics
  const passed = results.filter(
    (result) => result.status === "PASS"
  ).length;

  const failed = results.filter(
    (result) => result.status === "FAIL"
  ).length;

  const errors = results.filter(
    (result) => result.status === "ERROR"
  ).length;

  const completed = passed + failed;

  const accuracy =
    completed > 0
      ? (passed / completed) * 100
      : 0;

  const coverage =
    results.length > 0
      ? (completed / results.length) * 100
      : 0;

  // 6. Calculate judge metrics
  const judgedResults = results.filter(
    (result) => result.judgeStatus === "OK"
  );

  const judgeErrors = results.filter(
    (result) => result.judgeStatus === "ERROR"
  ).length;

  const average = (
    key: "accuracy" | "faithfulness" | "completeness"
  ) => {
    if (judgedResults.length === 0) return 0;

    const total = judgedResults.reduce(
      (sum, result) => sum + (result[key] ?? 0),
      0
    );

    return total / judgedResults.length;
  };

  // 7. Print detailed evaluation results
  console.log("\n========== EVALUATION RESULTS ==========");

  console.table(
    results.map((result) => ({
      id: result.id,
      expected: result.expected,
      actual: result.actual,
      status: result.status,
      confidence: result.confidence ?? "N/A",
      judgeStatus: result.judgeStatus,
    }))
  );

  // 8. Print generated summaries
  console.log("\n========== TRIAGE SUMMARIES ==========");

  for (const result of results) {
    console.log(`\n${result.id}`);
    console.log(`Category   : ${result.actual}`);
    console.log(`Confidence : ${result.confidence ?? "N/A"}`);
    console.log(`Summary    : ${result.summary ?? "Not generated"}`);
  }

  // 9. Print deterministic evaluation report
  console.log("\n========== EVALUATION REPORT ==========");

  console.log(`Total cases          : ${results.length}`);
  console.log(`Completed            : ${completed}`);
  console.log(`Passed               : ${passed}`);
  console.log(`Failed               : ${failed}`);
  console.log(`Triage errors        : ${errors}`);

  console.log(`Accuracy             : ${accuracy.toFixed(2)}%`);
  console.log(`Evaluation coverage  : ${coverage.toFixed(2)}%`);

  // 10. Print LLM Judge report
  console.log("\n========== LLM JUDGE SCORES ==========");

  console.log(`Successfully judged  : ${judgedResults.length}`);
  console.log(`Judge errors         : ${judgeErrors}`);

  console.log(
    `Average accuracy     : ${average("accuracy").toFixed(2)} / 5`
  );

  console.log(
    `Average faithfulness : ${average("faithfulness").toFixed(2)} / 5`
  );

  console.log(
    `Average completeness : ${average("completeness").toFixed(2)} / 5`
  );

  console.log("=======================================\n");

  console.log("\n========== JUDGE VALIDATION DETAILS ==========");

for (const result of results) {
  if (!result.judgeFeedback) continue;

  console.log(`\n${result.id}`);

  console.log(
    `Accuracy: ${result.accuracy}/5`
  );
  console.log(
    `Reason: ${result.judgeFeedback.accuracy}`
  );

  console.log(
    `Faithfulness: ${result.faithfulness}/5`
  );
  console.log(
    `Reason: ${result.judgeFeedback.faithfulness}`
  );

  console.log(
    `Completeness: ${result.completeness}/5`
  );
  console.log(
    `Reason: ${result.judgeFeedback.completeness}`
  );
}

console.log("==============================================");
// Save evaluation report
const report = {
  version: "triage-v2",
  createdAt: new Date().toISOString(),

  metrics: {
    totalCases: results.length,
    completed,
    passed,
    failed,
    errors,
    accuracy,
    coverage,

    judge: {
      successfullyJudged: judgedResults.length,
      accuracy: average("accuracy"),
      faithfulness: average("faithfulness"),
      completeness: average("completeness"),
    },
  },

  results,
};

const reportsDirectory = new URL("./reports/", import.meta.url);

await mkdir(reportsDirectory, { recursive: true });

await writeFile(
  new URL("./reports/latest.json", import.meta.url),
  JSON.stringify(report, null, 2),
  "utf-8"
);

console.log("Evaluation report saved to evals/reports/latest.json");


}

// 11. Execute evaluation
runEvaluation().catch((error) => {
  console.error("Evaluation failed:", error);
  process.exitCode = 1;
});
