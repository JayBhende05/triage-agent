
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Status = "PASS" | "FAIL" | "ERROR";

type EvalResult = {
  id: string;
  expected: string;
  actual?: string;
  status: Status;
  accuracy?: number;
  faithfulness?: number;
  completeness?: number;
};

type EvalReport = {
  version: string;
  metrics: {
    totalCases: number;
    completed: number;
    passed: number;
    failed: number;
    errors: number;
    accuracy: number;
    coverage: number;
    judge: {
      successfullyJudged: number;
      accuracy: number;
      faithfulness: number;
      completeness: number;
    };
  };
  results: EvalResult[];
};

const REPORT_DIR = fileURLToPath(
  new URL("./reports/", import.meta.url)
);

const BASELINE_PATH = resolve(REPORT_DIR, "baseline.json");
const LATEST_PATH = resolve(REPORT_DIR, "latest.json");

// Ignore tiny floating-point differences.
const REGRESSION_THRESHOLD = 0.001;

function log(message = "") {
  console.log(message);
}

function validateReport(data: unknown, label: string): EvalReport {
  if (!data || typeof data !== "object") {
    throw new Error(`${label} is not a valid JSON object.`);
  }

  const report = data as Record<string, any>;

  if (typeof report.version !== "string") {
    throw new Error(`${label}: missing or invalid version.`);
  }

  if (!report.metrics || typeof report.metrics !== "object") {
    throw new Error(`${label}: metrics are missing.`);
  }

  if (!report.metrics.judge || typeof report.metrics.judge !== "object") {
    throw new Error(`${label}: judge metrics are missing.`);
  }

  if (!Array.isArray(report.results)) {
    throw new Error(`${label}: results must be an array.`);
  }

  const requiredMetrics = [
    "totalCases",
    "completed",
    "passed",
    "failed",
    "errors",
    "accuracy",
    "coverage",
  ];

  for (const key of requiredMetrics) {
    if (typeof report.metrics[key] !== "number") {
      throw new Error(`${label}: metrics.${key} must be a number.`);
    }
  }

  for (const key of [
    "successfullyJudged",
    "accuracy",
    "faithfulness",
    "completeness",
  ]) {
    if (typeof report.metrics.judge[key] !== "number") {
      throw new Error(`${label}: metrics.judge.${key} must be a number.`);
    }
  }

  const seen = new Set<string>();

  for (const result of report.results) {
    if (!result || typeof result !== "object") {
      throw new Error(`${label}: invalid result entry.`);
    }

    if (typeof result.id !== "string" || !result.id.trim()) {
      throw new Error(`${label}: every result needs a valid ID.`);
    }

    if (seen.has(result.id)) {
      throw new Error(`${label}: duplicate test ID "${result.id}".`);
    }

    seen.add(result.id);

    if (!["PASS", "FAIL", "ERROR"].includes(result.status)) {
      throw new Error(
        `${label}: invalid status for test "${result.id}".`
      );
    }

    if (typeof result.expected !== "string") {
      throw new Error(
        `${label}: expected must be a string for test "${result.id}".`
      );
    }

    for (const metric of [
      "accuracy",
      "faithfulness",
      "completeness",
    ] as const) {
      const value = result[metric];

      if (value !== undefined &&
          (typeof value !== "number" || !Number.isFinite(value))) {
        throw new Error(
          `${label}: invalid ${metric} for test "${result.id}".`
        );
      }
    }
  }

  return report as EvalReport;
}

async function loadReport(path: string, label: string): Promise<EvalReport> {
  log(`Reading ${label}: ${path}`);

  let content: string;

  try {
    content = await readFile(path, "utf-8");
  } catch {
    throw new Error(
      `Cannot read ${label} report.\nExpected file: ${path}\n` +
      `Make sure the evaluation has generated this JSON file.`
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`${label} contains invalid JSON.`);
  }

  const report = validateReport(parsed, label);

  log(`Loaded ${label}: ${report.version} (${report.results.length} cases)`);

  return report;
}

function showDelta(
  label: string,
  baseline: number,
  latest: number
) {
  const delta = latest - baseline;
  const sign = delta > 0 ? "+" : "";

  log(
    `${label.padEnd(20)} ${baseline.toFixed(3)} → ` +
    `${latest.toFixed(3)} (${sign}${delta.toFixed(3)})`
  );
}

function compareMetric(
  id: string,
  metric: string,
  before: number | undefined,
  after: number | undefined,
  regressions: string[],
  improvements: string[]
) {
  if (before === undefined || after === undefined) return;

  const delta = after - before;

  if (delta < -REGRESSION_THRESHOLD) {
    regressions.push(
      `${id}: ${metric} decreased (${before.toFixed(3)} → ${after.toFixed(3)})`
    );
  } else if (delta > REGRESSION_THRESHOLD) {
    improvements.push(
      `${id}: ${metric} improved (${before.toFixed(3)} → ${after.toFixed(3)})`
    );
  }
}

async function compareReports() {
  log("\n========================================");
  log("       EVALUATION REGRESSION REPORT");
  log("========================================\n");

  log("Starting comparison...\n");

  const baseline = await loadReport(BASELINE_PATH, "BASELINE");
  const latest = await loadReport(LATEST_PATH, "LATEST");

  log("\n----------------------------------------");
  log("VERSIONS");
  log("----------------------------------------");

  log(`Baseline: ${baseline.version}`);
  log(`Latest:   ${latest.version}`);

  log("\n----------------------------------------");
  log("CLASSIFICATION METRICS");
  log("----------------------------------------");

  showDelta(
    "Accuracy",
    baseline.metrics.accuracy,
    latest.metrics.accuracy
  );

  showDelta(
    "Coverage",
    baseline.metrics.coverage,
    latest.metrics.coverage
  );

  log("\n----------------------------------------");
  log("JUDGE METRICS");
  log("----------------------------------------");

  showDelta(
    "Judge accuracy",
    baseline.metrics.judge.accuracy,
    latest.metrics.judge.accuracy
  );

  showDelta(
    "Faithfulness",
    baseline.metrics.judge.faithfulness,
    latest.metrics.judge.faithfulness
  );

  showDelta(
    "Completeness",
    baseline.metrics.judge.completeness,
    latest.metrics.judge.completeness
  );

  const baselineResults = new Map(
    baseline.results.map(result => [result.id, result])
  );

  const latestResults = new Map(
    latest.results.map(result => [result.id, result])
  );

  const regressions: string[] = [];
  const improvements: string[] = [];
  const newErrors: string[] = [];
  const recoveredErrors: string[] = [];
  const newCases: string[] = [];
  const removedCases: string[] = [];
  const qualityRegressions: string[] = [];
  const qualityImprovements: string[] = [];

  for (const [id, latestResult] of latestResults) {
    const previous = baselineResults.get(id);

    if (!previous) {
      newCases.push(id);
      continue;
    }

    if (previous.status === "PASS" && latestResult.status !== "PASS") {
      regressions.push(
        `${id}: ${previous.status} → ${latestResult.status}`
      );
    } else if (
      previous.status === "FAIL" &&
      latestResult.status === "PASS"
    ) {
      improvements.push(id);
    }

    if (
      previous.status !== "ERROR" &&
      latestResult.status === "ERROR"
    ) {
      newErrors.push(id);
    }

    if (
      previous.status === "ERROR" &&
      latestResult.status !== "ERROR"
    ) {
      recoveredErrors.push(
        `${id}: ERROR → ${latestResult.status}`
      );
    }

    compareMetric(
      id,
      "accuracy",
      previous.accuracy,
      latestResult.accuracy,
      qualityRegressions,
      qualityImprovements
    );

    compareMetric(
      id,
      "faithfulness",
      previous.faithfulness,
      latestResult.faithfulness,
      qualityRegressions,
      qualityImprovements
    );

    compareMetric(
      id,
      "completeness",
      previous.completeness,
      latestResult.completeness,
      qualityRegressions,
      qualityImprovements
    );
  }

  for (const id of baselineResults.keys()) {
    if (!latestResults.has(id)) {
      removedCases.push(id);
    }
  }

  log("\n----------------------------------------");
  log("INDIVIDUAL TEST CASE CHANGES");
  log("----------------------------------------");

  function printList(label: string, items: string[]) {
    log(`\n${label} (${items.length})`);

    if (items.length === 0) {
      log("  None");
      return;
    }

    for (const item of items) {
      log(`  - ${item}`);
    }
  }

  printList("Classification regressions", regressions);
  printList("Classification improvements", improvements);
  printList("New execution errors", newErrors);
  printList("Recovered execution errors", recoveredErrors);
  printList("New test cases", newCases);
  printList("Removed test cases", removedCases);

  log("\n----------------------------------------");
  log("INDIVIDUAL QUALITY CHANGES");
  log("----------------------------------------");

  printList("Quality regressions", qualityRegressions);
  printList("Quality improvements", qualityImprovements);

  log("\n----------------------------------------");
  log("FINAL SUMMARY");
  log("----------------------------------------");

  const hasRegressions =
    regressions.length > 0 ||
    newErrors.length > 0 ||
    removedCases.length > 0 ||
    qualityRegressions.length > 0;

  if (hasRegressions) {
    log("RESULT: REVIEW REQUIRED");
    log("Regression or test coverage issues detected.");
  } else {
    log("RESULT: NO REGRESSIONS DETECTED");
    log("The latest evaluation passed the comparison checks.");
  }

  log("\n========================================");
  log("       COMPARISON COMPLETED");
  log("========================================\n");
}

compareReports().catch((error: unknown) => {
  console.error("\n[COMPARE ERROR]");

  console.error(
    error instanceof Error ? error.message : error
  );

  process.exitCode = 1;
});
