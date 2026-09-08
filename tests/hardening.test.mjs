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
import { runAnalysis, runAnalysisSync } from "../src/lib/runAnalysis.js";
import { normalizeValue, valueFrequencies, cramersV, mutualInformation,
         discretize, sampleIndices, pearson, spearman } from "../src/components/utils/core/helpers.js";

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

/* ══════════════════════════════════════════
   8. EVIDENCE CAPS — stage 5
   The score measured how good the data LOOKED and never asked whether there was
   enough of it to justify saying so. Measured before the cap layer:
     2 rows / 2 cols             -> 84 "Good"
     1 row                       -> 77 "Good"
     titanic, PassengerId target -> 88 "Good", targetReadiness 100
     titanic, Survived target    -> 93 "Excellent", with Cabin 77% missing
   An overconfident score is more dangerous than a crash: it does not look like
   a defect, so nobody goes looking for one.
══════════════════════════════════════════ */
console.log("\nThe score cannot claim more than the evidence supports\n");

const tiny  = analyzeDataset([{ a: "1", b: "x" }, { a: "2", b: "y" }], ["a", "b"], "b");
const idTgt = analyzeDataset(idRows, ["pid", "v"], "pid");

check("a 2-row dataset is not graded Good or Excellent",
  tiny.healthScore.score < 60);

check("an identifier chosen as target is not graded as usable",
  idTgt.healthScore.score <= 40);

check("an identifier target is never described as balanced",
  !idTgt.insights.some(i => /balanc/i.test(i.title ?? "")));

/* Every cap must explain itself. A score that is quietly lower teaches the user
   nothing; the reason is the part that has value. */
const allCaps = [...tiny.healthScore.limits, ...idTgt.healthScore.limits];
check("every cap carries a non-empty human reason",
  allCaps.length > 0 && allCaps.every(c => typeof c.reason === "string" && c.reason.length > 10));

check("every cap names a ceiling the final score actually respects",
  allCaps.every(c => Number.isFinite(c.max))
    && tiny.healthScore.score <= Math.min(...tiny.healthScore.limits.map(c => c.max)));

/* THE false positive this design has to avoid. A continuous regression target
   (price, fare, temperature) is ALSO one distinct value per row, so a rule based
   on class count alone would condemn every legitimate regression dataset.
   Identifier-ness, not cardinality, is the discriminator. */
const priceRows = Array.from({ length: 600 }, (_, i) => ({
  size:  String(100 + (i % 173)),
  grade: ["a", "b", "c"][i % 3],
  price: String(1000 + i * 7.31),          // continuous, one distinct value per row
}));
const priceRun = analyzeDataset(priceRows, ["size", "grade", "price"], "price");
check("a continuous regression target is NOT mistaken for an identifier",
  priceRun.meta.targetIsIdentifier === false
    && !priceRun.healthScore.limits.some(c => /identifier/i.test(c.reason)));

/* Caps must not make a good grade unreachable — they bound overreach, they are
   not a blanket penalty. */
const cleanRows = Array.from({ length: 2000 }, (_, i) => ({
  measure: String((i * 7919) % 100000),
  price:   String((i % 997) / 7),
  grp:     ["a", "b", "c"][i % 3],
  code:    String(i % 4),
  y:       i % 2 ? "yes" : "no",
}));
const clean = analyzeDataset(cleanRows, ["measure", "price", "grp", "code", "y"], "y");
check("a large clean dataset still reaches Excellent (caps bound overreach, not everything)",
  clean.healthScore.score >= 90 && clean.healthScore.limits.length === 0);

check("an uncapped run reports no limits",
  clean.healthScore.limits.length === 0);

/* ══════════════════════════════════════════
   9. STATISTICAL DEPTH — stage 7
   phase0 pins Spearman and the p-values against scipy to machine precision.
   What is checked here is the behaviour those numbers were added FOR: that the
   engine stops saying "no association" when it means "no LINEAR association",
   and that the new estimators are not the biased kind stage 2 had to remove.
══════════════════════════════════════════ */
console.log("\nStatistical depth: relationships Pearson alone cannot see\n");

/* A U-shaped relationship is invisible to BOTH correlations — every increase on
   the left is matched by a decrease on the right — yet y is fully determined by
   x. Mutual information is the only measure here that sees it. */
const uRows = Array.from({ length: 400 }, (_, i) => {
  const x = -2 + (4 * i) / 400;
  return { x: String(x), y: String(x * x) };
});
const uPearson  = Math.abs(pearson(uRows, "x", "y"));
const uSpearman = Math.abs(spearman(uRows, "x", "y").rho);
const uMI = mutualInformation(discretize(uRows.map(r => r.x)), discretize(uRows.map(r => r.y)));

check("both correlations report ~0 on a U-shaped relationship",
  uPearson < 0.1 && uSpearman < 0.1);

check("mutual information detects the relationship both correlations miss",
  uMI.normalized > 0.3);

/* The bias trap stage 2 existed to fix, in a new estimator: a plug-in MI grows
   with the number of cells, so independent columns must not score above zero. */
const indepA = Array.from({ length: 2000 }, (_, i) => String(i % 7));
const indepB = Array.from({ length: 2000 }, (_, i) => String((i * 13) % 11));
check("mutual information of independent columns is ~0 (Miller-Madow correction holds)",
  mutualInformation(indepA, indepB).normalized < 0.02);

/* Categorical<->categorical association between FEATURES — the correlation
   matrix covers numeric columns only, so two category columns encoding the same
   thing were previously undetectable. */
const dupCatRows = Array.from({ length: 400 }, (_, i) => {
  const base = ["red", "green", "blue"][i % 3];
  return { colour: base, shade: base === "red" ? "warm" : "cool", unrelated: ["p", "q"][i % 2] };
});
const dupAssoc = analyzeDataset(dupCatRows, ["colour", "shade", "unrelated"], "unrelated")
  .relationships.categoricalAssociations;
check("two categorical features encoding the same thing are reported as associated",
  dupAssoc.some(a => (a.col1 === "colour" && a.col2 === "shade") || (a.col1 === "shade" && a.col2 === "colour")));

check("every categorical association carries a p-value and its level counts",
  dupAssoc.every(a => a.pValue != null && Array.isArray(a.levels) && a.levels.length === 2));

/* Same Bergsma correction as the target-side estimator — a per-row-unique pair
   must not score, or stage 2's defect is simply re-introduced elsewhere. */
const uniqA = Array.from({ length: 300 }, (_, i) => `a_${i}`);
const uniqB = Array.from({ length: 300 }, (_, i) => `b_${i}`);
check("feature-to-feature Cramér's V is Bergsma-corrected too (per-row-unique pair scores ~0)",
  (cramersV(uniqA, uniqB)?.v ?? 1) < 0.1);

/* Sampling is legitimate for an estimator like MI but must be deterministic —
   the same file has to produce the same report twice. */
const s1 = sampleIndices(1_000_000);
const s2 = sampleIndices(1_000_000);
check("MI subsampling is deterministic and visits distinct rows",
  s1.length === s2.length && s1.every((v, i) => v === s2[i]) && new Set(s1).size === s1.length);

check("a small dataset is not subsampled at all",
  sampleIndices(500).length === 500);

/* Every reported coefficient must be able to say whether it is distinguishable
   from chance — that is what makes it reportable rather than decorative. */
const depth = analyzeDataset(
  Array.from({ length: 500 }, (_, i) => ({
    strong: String(i), noise: String((i * 37) % 101), y: i % 2 ? "1" : "0",
  })), ["strong", "noise", "y"], "y");
check("every target correlation carries a p-value and its sample size",
  Object.values(depth.relationships.targetCorrelations)
    .every(e => "pValue" in e && Number.isFinite(e.n)));

/* ══════════════════════════════════════════
   10. RECOMMENDATIONS — stage 8
   Advice was type-blind: rules keyed off a quality flag or a lone statistic and
   never asked what KIND of column they were talking about. The worst case was
   not unhelpful advice, it was DESTRUCTIVE advice — a near-unique column told
   to group every level below 1% into "Other", which merges all of them and
   leaves a constant column.
══════════════════════════════════════════ */
console.log("\nRecommendations know what kind of column they are advising on\n");

const adviceRows = Array.from({ length: 400 }, (_, i) => ({
  free_text: `record number ${i} with unique text`,   // 400/400 distinct
  city:      ["london", "paris", "berlin"][i % 3],
  kids:      String(i % 9),                            // count, 0-8, skewed
  amount:    String(Math.exp(i / 55)),                 // continuous, long tail
  y:         i % 2 ? "yes" : "no",
}));
const advice = analyzeDataset(adviceRows, ["free_text", "city", "kids", "amount", "y"], "y").recommendations;
const forCol = col => advice.filter(r => r.column === col);

/* THE regression guard. This exact sentence, aimed at a near-unique column,
   is the defect stage 8 exists to remove. */
check("a near-unique column is never told to group rare levels into \"Other\"",
  forCol("free_text").every(r => !/into "Other"/.test(r.action)));

check("a near-unique column is told it behaves like an identifier or free text",
  forCol("free_text").some(r => /derive|drop/i.test(r.action)));

/* Counts and continuous measures both skew; only one of them wants a log. */
const kidsAdvice   = forCol("kids").map(r => r.action).join(" ");
const amountAdvice = forCol("amount").map(r => r.action).join(" ");
check("a small-integer count is not told to log-transform",
  !/log1p/.test(kidsAdvice));
check("a continuous long-tailed column still is",
  /log1p/.test(amountAdvice));

/* Imputation must follow the role, not whether a statistics row happened to exist. */
const impRows = Array.from({ length: 300 }, (_, i) => ({
  when:  i % 10 === 0 ? "" : `2024-0${(i % 9) + 1}-15`,
  label: i % 11 === 0 ? "" : ["a", "b", "c"][i % 3],
  num:   i % 12 === 0 ? "" : String(i % 50),
  y:     i % 2 ? "p" : "q",
}));
const impAdvice = analyzeDataset(impRows, ["when", "label", "num", "y"], "y").recommendations;
const actionFor = col => impAdvice.filter(r => r.column === col && /Missing/.test(r.issue)).map(r => r.action).join(" ");

check("a date column is not told to impute with a mean or a mode",
  !/mean|mode/i.test(actionFor("when")) && /forward-fill|interpolat/i.test(actionFor("when")));
check("a categorical column is told to use the most frequent level or Unknown",
  /most frequent level|Unknown/i.test(actionFor("label")));

/* A mostly-empty column still carries whether it was present. */
const sparseRows = Array.from({ length: 300 }, (_, i) => ({
  sparse: i % 4 === 0 ? "value" : "",     // 75% missing
  other:  String(i % 17),
  y:      i % 2 ? "a" : "b",
}));
const sparseAdvice = analyzeDataset(sparseRows, ["sparse", "other", "y"], "y")
  .recommendations.filter(r => r.column === "sparse");
check("a mostly-empty column is turned into a presence indicator, not simply discarded",
  sparseAdvice.some(r => /_present/.test(r.action)));

/* The target itself must be questioned — every other item is scoped to it. */
const idTargetAdvice = analyzeDataset(idRows, ["pid", "v"], "pid").recommendations;
check("an identifier target produces advice to change the target",
  idTargetAdvice.some(r => /different target/i.test(r.action)));
check("that advice is ranked above the feature advice it invalidates",
  idTargetAdvice.findIndex(r => /different target/i.test(r.action)) === 0);

/* Every recommendation has to be actionable and explain itself — the reason is
   what lets a user disagree on the evidence instead of obeying or ignoring. */
check("every recommendation carries an action and a rationale",
  advice.length > 0 && advice.every(r =>
    typeof r.action === "string" && r.action.length > 10 &&
    typeof r.rationale === "string" && r.rationale.length > 20));

/* ══════════════════════════════════════════
   11. OFF THE MAIN THREAD — stage 8.5
   The worker itself needs a browser and is verified there (0 animation frames
   during a main-thread run, 97 during a worker run, identical scores). What is
   checked HERE is the fallback, because the fallback is what runs when the
   worker cannot: in Node, under a Content Security Policy that blocks module
   workers, or if bundling ever breaks. It must never be the path that fails.
══════════════════════════════════════════ */
console.log("\nAnalysis runs off the main thread, and still runs when it cannot\n");

const wRows = Array.from({ length: 500 }, (_, i) => ({
  a: String(i % 97), b: String((i * 7) % 13), y: i % 2 ? "yes" : "no",
}));

const syncRun = runAnalysisSync(wRows, ["a", "b", "y"], "y");
check("the synchronous path returns a result and a null error",
  syncRun.error === null && Number.isFinite(syncRun.result?.healthScore?.score));

check("the synchronous path RETURNS a failure instead of throwing",
  (() => { const r = runAnalysisSync(null, null, null);
           return r.result === null && typeof r.error === "string" && r.error.length > 0; })());

/* `Worker` is undefined in Node, so this exercises the exact fallback branch a
   blocked or broken worker would take in a browser. */
const asyncRun = await runAnalysis(wRows, ["a", "b", "y"], "y");
check("the async wrapper falls back cleanly where Worker does not exist",
  Number.isFinite(asyncRun.result?.healthScore?.score));

check("fallback and direct paths produce an identical score",
  asyncRun.result.healthScore.score === syncRun.result.healthScore.score);

check("a hostile input through the async wrapper resolves as an error, never rejects",
  await runAnalysis(null, null, null).then(r => r.result === null && !!r.error, () => false));

console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"}`);
process.exit(failures === 0 ? 0 : 1);
