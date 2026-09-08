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
import { detectColumnRoles } from "../src/components/utils/core/detectors/roles.js";
import { ROLE } from "../src/components/utils/core/roles.constants.js";
import { validateFile, inspectParseResult, MAX_SIZE_B } from "../src/lib/csvIntake.js";
import { normalizeValue, valueFrequencies } from "../src/components/utils/core/helpers.js";

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

/* Was: health.js did Math.abs(entry) on a {metric,value,absValue} object.
   Math.abs(object) is NaN, every NaN comparison is false, so signalScore fell
   through to its worst bucket (15) for EVERY dataset with a target and the
   relationships dimension was a constant carrying zero information. Fixed in
   stage 2, deliberately AFTER the Cramer's V bias correction below — until that
   landed, the strongest "signal" on a real file was an inflated high-cardinality
   column, so making the score listen to it would have made the score worse. */
check("relationships dimension distinguishes strong signal from none",
  strongSignal.breakdown.relationships !== weakSignal.breakdown.relationships);

check("a strong feature-target signal scores the relationships dimension higher than a weak one",
  strongSignal.breakdown.relationships > weakSignal.breakdown.relationships);

/* ══════════════════════════════════════════
   5. CORRELATION CORRECTNESS — stage 2 fixes, now guarded
══════════════════════════════════════════ */
console.log("\nCorrelation correctness\n");

/* A column with one distinct value per row carries no generalizable signal, but
   uncorrected Cramer's V rises toward 1.0 purely from cardinality. On Titanic
   this made "Name" (891/891 unique) outrank "Sex" as the reported top predictor
   of survival. The Bergsma (2013) correction added in stage 2 sends it to 0. */
const cardRows = Array.from({ length: 400 }, (_, i) => ({
  unique_note: `note_${i}`,
  real_signal: i % 2 === 0 ? "left" : "right",
  y:           i % 2 === 0 ? "1" : "0",
}));
const cardRel = getRelationshipsV3(cardRows, [], "y", new Set());

check("a genuinely predictive low-cardinality column is detected",
  (cardRel.targetCorrelations.real_signal?.absValue ?? 0) > 0.9);

check("a per-row-unique text column is not reported as a strong predictor",
  (cardRel.targetCorrelations.unique_note?.absValue ?? 1) < 0.3);

check("the real predictor outranks the per-row-unique column",
  (cardRel.targetCorrelations.real_signal?.absValue ?? 0)
    > (cardRel.targetCorrelations.unique_note?.absValue ?? 1));

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
  Math.sign(signA) === Math.sign(signB));

check("binary-feature correlation is identical, not merely same-signed, after reordering",
  signA === signB);

/* ══════════════════════════════════════════
   6. ROLE STABILITY — stage 3
   Roles decide which analysis every column receives, so a role that moves is a
   report that moves. Cardinality used to be judged against a 100-row head
   sample, making the verdict a function of dataset size rather than of the
   column: Pclass came back NUMERIC at n<=60 and CATEGORICAL at n>=80.
══════════════════════════════════════════ */
console.log("\nRole detection is stable and complete\n");

const SIZES = [20, 40, 60, 80, 100, 500, 5000];
const roleAt = (n, build, col) =>
  detectColumnRoles(Array.from({ length: n }, (_, i) => build(i)), [col], null)[col];

const shapes = {
  "a 3-level code":        { build: i => ({ c: String((i % 3) + 1) }), want: ROLE.CATEGORICAL },
  "a 0/1 flag":            { build: i => ({ c: String(i % 2) }),       want: ROLE.BINARY },
  "a 0-8 count":           { build: i => ({ c: String(i % 9) }),       want: ROLE.NUMERIC },
  "a continuous measure":  { build: i => ({ c: String(i * 1.7) }),     want: ROLE.NUMERIC },
  "a text category":       { build: i => ({ c: ["red","green","blue"][i % 3] }), want: ROLE.CATEGORICAL },
};

for (const [label, { build, want }] of Object.entries(shapes)) {
  const seen = SIZES.map(n => roleAt(n, build, "c"));
  check(`${label} keeps one role at every size (${SIZES.length} sizes, 20-5000 rows)`,
    seen.every(r => r === seen[0]));
  check(`${label} is ${want}`, seen[0] === want);
}

/* ROLE.BINARY was unreachable for the most common binary encoding there is: a
   numeric 0/1 column was claimed by the encoded-categorical branch first, so only
   text pairs (yes/no, male/female) ever reached it. */
const binaryEncodings = {
  "numeric 0/1":  i => ({ c: String(i % 2) }),
  "numeric 1/2":  i => ({ c: String((i % 2) + 1) }),
  "text yes/no":  i => ({ c: i % 2 ? "yes" : "no" }),
  "text m/f":     i => ({ c: i % 2 ? "male" : "female" }),
  "bool strings": i => ({ c: i % 2 ? "true" : "false" }),
};
for (const [label, build] of Object.entries(binaryEncodings)) {
  check(`ROLE.BINARY is reached by ${label}`, roleAt(500, build, "c") === ROLE.BINARY);
}

/* Normalization: one level written three ways is one level, not three. */
check("numeric levels are counted by value, so \"1\", \"1.0\" and \" 1 \" are one level",
  roleAt(300, i => ({ c: [" 1 ", "1.0", "1"][i % 3] }), "c") !== ROLE.BINARY);

/* A column of one distinct value carries no information and must not be mistaken
   for a binary flag. */
check("a constant column is not reported as binary",
  roleAt(300, () => ({ c: "7" }), "c") !== ROLE.BINARY);

/* ══════════════════════════════════════════
   7. VALUE NORMALIZATION — stage 4
   Three policies used to coexist: roles.js lowercased+trimmed, classBalance and
   visualizations keyed on the raw string, Cramer's V trimmed only. Measured
   before the fix: a column correctly detected as BINARY reported SIX classes
   (" Male ", "MALE", "male", "Female", "FEMALE", " female ") in the report shown
   directly beneath that label, and the headline read
   `" Male " is the most frequent value at 16.7%`.
══════════════════════════════════════════ */
console.log("\nValue normalization is one policy, engine-wide\n");

const messyRows = Array.from({ length: 300 }, (_, i) => ({
  sex: [" Male ", "MALE", "male", "Female", "FEMALE", " female "][i % 6],
  y:   i % 6 < 3 ? "1" : "0",
}));
const messy = analyzeDataset(messyRows, ["sex", "y"], "sex");

check("one level written six ways collapses to one class",
  messy.classBalance.classes.filter(c => !c.missing).length === 2);

/* A grouping KEY is lowercase; a LABEL a user reads must not be. Collapsing the
   levels must not cost the report its capitalisation. */
check("the surviving class label keeps its original capitalisation",
  messy.classBalance.classes.some(c => c.value === "Male")
    && messy.classBalance.classes.some(c => c.value === "Female"));

/* The invariant Stage 4 exists to protect: role detection and the rendered
   report must count a column's levels the same way. A column labelled BINARY
   above a list of six classes is the product contradicting itself on one screen. */
const messyViz = analyzeDataset(messyRows, ["sex", "y"], "y")
  .visualizations.find(v => v.col === "sex");
check("role detection and the rendered report agree on how many levels a column has",
  messy.meta.columnRoles.sex === ROLE.BINARY && messyViz.data.length === 2);

check("the frequency headline reports the collapsed count, not the raw spellings",
  messyViz.insight.includes("2 unique categories"));

/* Missing tokens are excluded everywhere else; Cramer's V used to count them as
   real categories because it only trimmed. */
const naRows = Array.from({ length: 200 }, (_, i) => ({
  grp: ["a", "b", "NA", "None"][i % 4],
  y:   i % 2 ? "1" : "0",
}));
check("missing tokens do not become categories",
  valueFrequencies(naRows, "grp").length === 2);

check("normalizeValue keys numbers by value, so \"1\", \"1.0\" and \" 1 \" agree",
  normalizeValue("1") === normalizeValue("1.0") && normalizeValue("1.0") === normalizeValue(" 1 "));

check("normalizeValue is case- and whitespace-insensitive for text",
  normalizeValue(" Male ") === normalizeValue("MALE"));

console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"}`);
process.exit(failures === 0 ? 0 : 1);
