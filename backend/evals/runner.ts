import {readFile} from "node:fs/promises"
import {z} from 'zod'


import { GroqModel } from "../src/agent/model.ts";
import { TriageSchema, CATEGORIES } from "../src/agent/types.ts";
import { TRIAGE_SYSTEM, ticketBlock } from "../src/agent/prompts.ts";
import { config } from "../src/config.ts";

import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { scoreTriage } from "./scorers/triage.scorer.ts";
import { readdir } from "node:fs";
import { parse } from "node:path";


const EvalCaseSchema = z.object({
  id : z.string(),
  input : z.object({
    from_email : z.string(),
    subject: z.string(),
    body : z.string()
  }),
  expected : z.object({
    category : z.enum(CATEGORIES)
  }),
    tags: z.union([
    z.array(z.string()),
    z.string()
  ]).optional(),
});

type EvalCase = z.infer<typeof EvalCaseSchema>;



async function loadDataset(){
  const file = await readFile(new URL('./datasets/triage.json' , import.meta.url), "utf-8");

  const parsed = z.array(EvalCaseSchema).safeParse(JSON.parse(file));

  if (!parsed.success) {
    throw new Error(
      `Invalid evaluation dataset:\n${z.prettifyError(parsed.error)}`
    );
  }

  return parsed.data
}


async function runEvaluation() {
  const dataset = await loadDataset();

  const model = new GroqModel(config.groqApiKey);

  const results = [];

  console.log(`\nRunning ${dataset.length} evaluation cases...\n`);

  for (const testCase of dataset) {
    try {
      // Use the same prompt and ticket formatting as the real graph
      const messages = [
        new SystemMessage(TRIAGE_SYSTEM),
        new HumanMessage(ticketBlock(testCase.input)),
      ];

      // Get actual LLM prediction
      const prediction = await model.structured(
        "triage",
        TriageSchema,
        messages
      );

      // Compare expected and actual
      const score = scoreTriage(
        testCase.expected.category,
        prediction.category
      );

      results.push({
        id: testCase.id,
        expected: score.expected,
        actual: score.actual,
        status: score.passed ? "PASS" : "FAIL",
        confidence : prediction.confidence, 
        summary : prediction.summary
      });

      console.log(
        `${testCase.id}: ${score.passed ? "PASS" : "FAIL"}`
      );

    } catch (error) {
      results.push({
        id: testCase.id,
        expected: testCase.expected.category,
        actual: "ERROR",
        status: "ERROR",
                confidence : "ERROR", 
        summary : "ERROR"
      });

      console.error(`${testCase.id}: ERROR`, error);
    }
  }

  // 4. Calculate accuracy
  const passed = results.filter(
    (result) => result.status === "PASS"
  ).length;

  const failed = results.length - passed;

  const accuracy = (passed / results.length) * 100;

  // 5. Print report
  console.log("\n========== EVALUATION REPORT ==========");

  console.table(results);

  console.log(`Total cases : ${results.length}`);
  console.log(`Passed      : ${passed}`);
  console.log(`Failed      : ${failed}`);
  console.log(`Accuracy    : ${accuracy.toFixed(2)}%`);

  console.log("=======================================\n");
}

runEvaluation().catch((error) => {
  console.error("Evaluation failed:", error);
  process.exitCode = 1;
});