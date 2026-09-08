/* hardening.test.mjs — plain Node, no framework (same style as the other two).

   phase0.test.mjs proves the statistics are numerically right.
   engine-contract.test.mjs proves the returned shape is stable.
   This file proves the engine SURVIVES real input: sizes inside the advertised
   40MB upload limit, malformed CSVs, and pathological target columns.

   Why it exists: a Titanic run on 2026-09-08 found a live bug in health.js
   (Math.abs() on an object → NaN → one whole score dimension pinned to a
   constant) that the existing suite could not see, because its fixture passes
   `target: null` + `targetCorrelations: {}` and never enters the broken branch.
   Green tests that guard an unreachable path are worse than no tests. */

import { buildHistogram, minMax } from "../src/components/utils/core/helpers.js";
import { getStatistics, getVisualizations } from "../src/components/utils/core/analyzers/stats.js";
import { getRelationshipsV3 } from "../src/components/utils/core/analyzers/relations.js";
import { getHealthScore } from "../src/components/utils/core/scoring/health.js";
import { analyzeDataset } from "../src/components/utils/core/index.js";
import { validateFile, inspectParseResult, MAX_SIZE_B } from "../src/lib/csvIntake.js";

let failures = 0;

/* `knownBroken: true` marks a defect this suite deliberately pins BEFORE its fix
   lands, so the bug is recorded instead of forgotten. It reports XFAIL and does
   not fail the run — but if it starts passing it reports XPASS and DOES fail,
   forcing the flag to be dropped the moment the fix lands. A known bug never
   silently becomes an untested one. */
function check(name, ok, knownBroken = false) {
  if (knownBroken) {
    if (ok) { failures++; console.log(`XPASS ${name}  <-- fixed: remove the knownBroken flag`); }
    else console.log(`XFAIL ${name}  (known, scheduled)`);
    return;
  }
  if (!ok) failures++;
  console.log(`${ok ? "PASS " : "FAIL "} ${name}`);
}

function survives(fn) {
  try { fn(); return true; } catch { return false; }
}

/* ══════════════════════════════════════════
   1. SIZE — no crash inside the advertised upload limit
   Math.min(...arr) pushes every element as a call argument and throws
   RangeError above ~125k values. A 40MB CSV holds several hundred thousand
   rows, so this was reachable with a perfectly valid file.
══════════════════════════════════════════ */
console.log("\nLarge-input safety (40MB allows ~600k rows)\n");

const BIG = 200_000;
const bigVals = Array.from({ length: BIG }, (_, i) => (i * 7919) % 100_000);
const bigRows = bigVals.map((v, i) => ({ id: String(i), measure: String(v), flag: i % 2 ? "yes" : "no" }));
const bigCols = ["id", "measure", "flag"];

check(`minMax() matches Math.min/max on a small array`,
  (() => { const a = [5, -2, 9, 0, 3]; const { min, max } = minMax(a);
           return min === Math.min(...a) && max === Math.max(...a); })());

check(`minMax() handles ${BIG.toLocaleString()} values`,
  survives(() => { const { min, max } = minMax(bigVals);
                   if (!Number.isFinite(min) || !Number.isFinite(max)) throw new Error("not finite"); }));

check(`buildHistogram() handles ${BIG.toLocaleString()} values`,
  survives(() => { const h = buildHistogram(bigVals); if (h.length !== 10) throw new Error("bad bins"); }));

check(`getStatistics() handles ${BIG.toLocaleString()} rows`,
  survives(() => { const s = getStatistics(bigRows, ["measure"]);
                   if (s[0].count !== BIG) throw new Error("wrong count"); }));

check(`getVisualizations() handles ${BIG.toLocaleString()} rows`,
  survives(() => getVisualizations(bigRows, bigCols, ["measure"], ["flag"])));

check(`analyzeDataset() completes end-to-end on ${BIG.toLocaleString()} rows`,
  survives(() => { const r = analyzeDataset(bigRows, bigCols, "flag");
                   if (!Number.isFinite(r.healthScore.score)) throw new Error("non-finite score"); }));

/* ══════════════════════════════════════════
   2. INTAKE — a malformed CSV must never analyze silently
   Home.jsx ignored results.errors entirely: a file with hundreds of ragged
   rows parsed "successfully" and was analyzed with no warning at all.
══════════════════════════════════════════ */
console.log("\nCSV intake validation\n");

const okResult = {
  data:   [{ a: "1", b: "2" }, { a: "3", b: "4" }],
  meta:   { fields: ["a", "b"] },
  errors: [],
};

check("clean parse result passes with no warning",
  (() => { const v = inspectParseResult(okResult); return v.error === null && v.malformed === null; })());

check("no header fields is rejected as a parse error",
  inspectParseResult({ ...okResult, meta: { fields: [] } }).error === "parse");

check("zero data rows is rejected as a parse error",
  inspectParseResult({ ...okResult, data: [] }).error === "parse");

check("undefined/garbage result is rejected, not thrown on",
  survives(() => inspectParseResult(undefined)) && inspectParseResult(undefined).error === "parse");

check("ragged rows are surfaced as a warning, not swallowed",
  (() => {
    const v = inspectParseResult({ ...okResult, errors: [
      { type: "FieldMismatch", code: "TooFewFields",  row: 0 },
      { type: "FieldMismatch", code: "TooManyFields", row: 1 },
    ] });
    return v.error === null && v.malformed?.count === 2;
  })());

check("malformed row numbers are reported as 1-indexed file lines (header counted)",
  (() => { const v = inspectParseResult({ ...okResult, errors: [{ code: "TooFewFields", row: 0 }] });
           return v.malformed.sampleRows[0] === 2; })());

check("duplicate errors on one row are counted once",
  (() => { const v = inspectParseResult({ ...okResult, errors: [
             { code: "TooFewFields", row: 3 }, { code: "TooManyFields", row: 3 }] });
           return v.malformed.count === 1; })());

check("errors with no row number do not fabricate a warning",
  inspectParseResult({ ...okResult, errors: [{ code: "UndetectableDelimiter" }] }).malformed === null);

check("oversized file is rejected",
  validateFile({ name: "big.csv", type: "text/csv", size: MAX_SIZE_B + 1 }) === "size");

check("non-CSV file is rejected",
  validateFile({ name: "notes.txt", type: "text/plain", size: 10 }) === "format");

check("valid CSV file is accepted",
  validateFile({ name: "data.csv", type: "text/csv", size: 1000 }) === null);

/* ══════════════════════════════════════════
   3. PATHOLOGICAL TARGETS — must not crash the report
══════════════════════════════════════════ */
console.log("\nPathological targets\n");

const idRows = Array.from({ length: 2000 }, (_, i) => ({ pid: String(i), v: String(i % 13) }));

check("a fully-unique identifier chosen as target does not crash",
  survives(() => analyzeDataset(idRows, ["pid", "v"], "pid")));

check("a target with thousands of distinct classes still returns finite class balance",
  (() => { const r = analyzeDataset(idRows, ["pid", "v"], "pid");
           return r.classBalance.classes.length > 1000
             && r.classBalance.classes.every(c => Number.isFinite(c.pct)); })());

/* ══════════════════════════════════════════
   4. SCORING INTEGRITY — the gap that let the NaN bug ship
   These execute the branch the existing health fixture skips: a real target
   WITH populated targetCorrelations. Values are {metric, value, absValue}
   objects (since FIX #4), not bare numbers.
══════════════════════════════════════════ */
console.log("\nHealth score responds to real inputs\n");

const scoringMeta = {
  target: "y", rows: 1000, columns: 6,
  numericCols: ["f1", "f2"], categoricalCols: ["c1"], identifierCols: [], temporalCols: [],
};
const scoringQuality  = { missingPct: 0, columnsWithIssues: [], duplicatesComputed: true, duplicateRows: 0 };
const balanced        = { classes: [{ value: "a", pct: 50 }, { value: "b", pct: 50 }], isImbalanced: false };
const relWith = absValue => ({
  multicollinearPairs: [], leakageSuspects: [],
  targetCorrelations: { f1: { metric: "pearson", value: absValue, absValue } },
});

const strongSignal = getHealthScore({
  meta: scoringMeta, quality: scoringQuality, statistics: [],
  relationships: relWith(0.9), classBalance: balanced,
});
const weakSignal = getHealthScore({
  meta: scoringMeta, quality: scoringQuality, statistics: [],
  relationships: relWith(0.02), classBalance: balanced,
});

check("health score is finite when targetCorrelations is populated",
  Number.isFinite(strongSignal.score) && Number.isFinite(strongSignal.breakdown.relationships));

/* THE bug: health.js does Math.abs(entry) on a {metric,value,absValue} object.
   Math.abs(object) is NaN, every NaN comparison is false, so signalScore falls
   through to its worst bucket (15) for EVERY dataset that has a target — the
   relationships dimension is a constant, carrying zero information.
   relations.js already fixed this exact read (FIX P1); health.js was missed.
   Scheduled for stage 2 — and deliberately NOT fixed before the Cramer's V
   bias correction, because until then the strongest "signal" on a real file is
   an inflated high-cardinality column, and trusting it makes the score worse. */
check("relationships dimension distinguishes strong signal from none",
  strongSignal.breakdown.relationships !== weakSignal.breakdown.relationships,
  true);

/* ══════════════════════════════════════════
   5. CORRELATION CORRECTNESS — stage 2 targets, pinned now
══════════════════════════════════════════ */
console.log("\nCorrelation correctness\n");

/* A column with one distinct value per row carries no generalizable signal, but
   uncorrected Cramer's V rises toward 1.0 purely from cardinality. On Titanic
   this made "Name" (891/891 unique) outrank "Sex" as the reported top predictor
   of survival. Bergsma (2013) bias correction sends it to ~0. */
const cardRows = Array.from({ length: 400 }, (_, i) => ({
  unique_note: `note_${i}`,
  real_signal: i % 2 === 0 ? "left" : "right",
  y:           i % 2 === 0 ? "1" : "0",
}));
const cardRel = getRelationshipsV3(cardRows, [], "y", new Set());

check("a genuinely predictive low-cardinality column is detected",
  (cardRel.targetCorrelations.real_signal?.absValue ?? 0) > 0.9);

check("a per-row-unique text column is not reported as a strong predictor",
  (cardRel.targetCorrelations.unique_note?.absValue ?? 1) < 0.3,
  true);

/* Binary text features are encoded 0/1 by order of first appearance
   ([...new Set()] is insertion-ordered), so moving one row to the top of the
   file flips the sign of r — on Titanic, +0.54 to -0.54 for Sex, inverting the
   stated conclusion from the same data. */
const signRows = Array.from({ length: 300 }, (_, i) => ({
  sex: i % 3 === 0 ? "female" : "male",
  y:   i % 3 === 0 ? "1" : "0",
}));
const movedRows = [signRows[1], ...signRows.filter((_, i) => i !== 1)];
const signA = getRelationshipsV3(signRows, [], "y", new Set()).targetCorrelations.sex?.value;
const signB = getRelationshipsV3(movedRows, [], "y", new Set()).targetCorrelations.sex?.value;

check("binary-feature correlation keeps its sign when rows are reordered",
  Math.sign(signA) === Math.sign(signB),
  true);

console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"}`);
process.exit(failures === 0 ? 0 : 1);
