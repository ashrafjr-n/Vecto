/* engine-contract.test.mjs — plain Node, no framework.

   Locks the SHAPE of analyzeDataset()'s return value: the exact key set of the
   top-level result and of every nested object/array-element the UI consumes.

   Why this file exists (and survives the UI rewrite while UI tests would not):
   the frontend is about to be rebuilt from scratch. The new UI will be written
   against this contract, not against today's components. If a future change to
   the analysis engine renames, adds, or removes a field, THIS test fails loudly
   at the engine boundary — instead of the new UI silently rendering `undefined`
   somewhere. phase0.test.mjs checks the engine's numbers are correct; this file
   checks the engine's OUTPUT SHAPE is what every consumer is allowed to assume.

   Deliberately excluded from the locked shape: `insights[].text` / `.title` wording
   and `recommendations[].action` / `.issue` wording — those are human-readable
   strings that are expected to be tuned over time and are covered by their own
   behavioral assertions in phase0.test.mjs, not pinned here field-by-field. */

import { analyzeDataset } from "../src/components/utils/core/index.js";

let failures = 0;

function assertKeysExact(actual, expected, label) {
  const a = Object.keys(actual).sort();
  const e = [...expected].sort();
  const pass = a.length === e.length && a.every((k, i) => k === e[i]);
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label} keys exactly [${e.join(", ")}]`);
  if (!pass) console.log(`        actual: [${a.join(", ")}]`);
  return pass;
}

function assertType(value, type, label) {
  const actual = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  const pass = actual === type;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label} is ${type} (actual: ${actual})`);
  return pass;
}

/* ── Fixture: 40 rows, one binary target, two numeric feature columns (one with
   15% missing — inside insights.js's 5–50% warning band), one categorical column.
   Small and boring on purpose: this test is about SHAPE, not statistics. ── */
const ROWS = Array.from({ length: 40 }, (_, i) => ({
  age:   i < 6 ? "" : String(20 + (i % 40)),   // 6/40 = 15% missing, numeric
  score: String((i * 7) % 100),                 // numeric, no missing
  dept:  ["Engineering", "Sales", "HR"][i % 3], // categorical
  y:     i % 2 === 0 ? "1" : "0",               // binary target
}));
const COLUMNS = ["age", "score", "dept", "y"];

/* ══════════════════════════════════════════
   RUN A — with target (exercises classBalance,
   target-aware recommendations/insights)
══════════════════════════════════════════ */
console.log("Engine contract — analyzeDataset() WITH target\n");

const withTarget = analyzeDataset(ROWS, COLUMNS, "y");

assertKeysExact(withTarget, [
  "meta", "quality", "statistics", "visualizations",
  "relationships", "classBalance", "snapshot",
  "insights", "healthScore", "recommendations",
], "analyzeDataset() result");

assertKeysExact(withTarget.meta, [
  "rows", "columns", "numericCols", "categoricalCols", "identifierCols",
  "temporalCols", "textCols", "columnRoles", "target", "targetIsIdentifier", "datasetType",
], "meta");

assertKeysExact(withTarget.quality, [
  "missingCells", "missingPct", "duplicateRows", "duplicatesComputed",
  "columnsWithIssues", "qualityScore", "scorePenalties", "scoreBase",
], "quality");

assertType(withTarget.statistics, "array", "statistics");
if (withTarget.statistics.length > 0) {
  assertKeysExact(withTarget.statistics[0], [
    "col", "mean", "median", "min", "max", "std", "q1", "q3", "iqr",
    "skewness", "kurtosis", "skewnessLabel", "outlierCount",
    "lowerFence", "upperFence", "count", "histogram", "isConstant",
  ], "statistics[0] (non-empty numeric column)");
} else {
  failures++;
  console.log("FAIL  statistics[] must be non-empty for this fixture (2 numeric feature cols)");
}

assertType(withTarget.visualizations, "array", "visualizations");
const numericViz     = withTarget.visualizations.find(v => v.type === "numeric");
const categoricalViz = withTarget.visualizations.find(v => v.type === "categorical");
if (numericViz) {
  assertKeysExact(numericViz, ["col", "type", "histogram", "isConstant", "boxplot", "insight"], "visualizations[] numeric entry");
  assertKeysExact(numericViz.boxplot, [
    "min", "max", "q1", "q3", "median", "lowerFence", "upperFence", "outlierCount",
  ], "visualizations[] numeric entry .boxplot");
} else {
  failures++;
  console.log("FAIL  expected at least one type:\"numeric\" visualization entry");
}
if (categoricalViz) {
  assertKeysExact(categoricalViz, ["col", "type", "data", "uniqueCount", "topPct", "insight"], "visualizations[] categorical entry");
} else {
  failures++;
  console.log("FAIL  expected at least one type:\"categorical\" visualization entry");
}

assertKeysExact(withTarget.relationships, [
  "cols", "correlationMatrix", "strongRelationships", "multicollinearPairs",
  "clusterDetected", "clusterCols", "leakageSuspects", "targetCorrelations",
  "categoricalAssociations", "observations", "excludedColumns", "unscoredColumns",
  "presenceSignals",
], "relationships");
assertType(withTarget.relationships.presenceSignals, "array",
  "relationships.presenceSignals (always an array; columns whose PRESENCE is associated with the target)");
assertType(withTarget.relationships.unscoredColumns, "array",
  "relationships.unscoredColumns (always an array; every column the target scan could not score, with its reason)");
assertType(withTarget.relationships.categoricalAssociations, "array",
  "relationships.categoricalAssociations (always an array, [] when nothing qualifies)");

assertType(withTarget.classBalance, "object", "classBalance (target set → non-null)");
if (withTarget.classBalance) {
  assertKeysExact(withTarget.classBalance, [
    "classes", "isImbalanced", "totalRows", "missingCount",
  ], "classBalance");
  assertType(withTarget.classBalance.classes, "array", "classBalance.classes");
  if (withTarget.classBalance.classes.length > 0) {
    assertKeysExact(withTarget.classBalance.classes[0], ["value", "count", "pct"], "classBalance.classes[0]");
  }
}

assertKeysExact(withTarget.snapshot, ["columns", "rows"], "snapshot");

assertType(withTarget.insights, "array", "insights");
if (withTarget.insights.length > 0) {
  assertKeysExact(withTarget.insights[0], ["severity", "title", "text", "priorityScore"], "insights[0]");
} else {
  failures++;
  console.log("FAIL  insights[] must be non-empty for this fixture (15% missing is in the 5-50% warning band)");
}

assertKeysExact(withTarget.healthScore, [
  "score", "grade", "breakdown", "qualityBreakdown", "limits", "hasTarget",
], "healthScore");
assertType(withTarget.healthScore.limits, "array", "healthScore.limits (always an array, [] when uncapped)");
assertKeysExact(withTarget.healthScore.breakdown, [
  "quality", "structure", "relationships", "targetReadiness",
], "healthScore.breakdown");

assertType(withTarget.recommendations, "array", "recommendations");
if (withTarget.recommendations.length > 0) {
  assertKeysExact(withTarget.recommendations[0], [
    "category", "priority", "column", "issue", "action", "rationale",
  ], "recommendations[0]");
} else {
  failures++;
  console.log("FAIL  recommendations[] must be non-empty for this fixture (missing values always recommend)");
}

/* ══════════════════════════════════════════
   RUN B — no target (unsupervised/EDA path):
   classBalance must be null, not an empty object or omitted key.
══════════════════════════════════════════ */
console.log("\nEngine contract — analyzeDataset() with NO target (target = null)\n");

const noTarget = analyzeDataset(ROWS, COLUMNS, null);

assertKeysExact(noTarget, Object.keys(withTarget), "analyzeDataset() result (no-target run, same key set)");

const classBalanceNullPass = noTarget.classBalance === null;
if (!classBalanceNullPass) failures++;
console.log(`${classBalanceNullPass ? "PASS" : "FAIL"}  classBalance is exactly null when target is null (not {} / undefined)`);

const datasetTypePass = noTarget.meta.datasetType === "Unknown";
if (!datasetTypePass) failures++;
console.log(`${datasetTypePass ? "PASS" : "FAIL"}  meta.datasetType is "Unknown" when target is null`);

console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"}`);
process.exit(failures === 0 ? 0 : 1);
