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
import { getQuality } from "../src/components/utils/core/analyzers/quality.js";
import { getRelationshipsV3 } from "../src/components/utils/core/analyzers/relations.js";
import { getHealthScore } from "../src/components/utils/core/scoring/health.js";
import { analyzeDataset, ANALYSIS_PHASES, detectTarget } from "../src/components/utils/core/index.js";
import { detectColumnRoles } from "../src/components/utils/core/detectors/roles.js";
import { ROLE } from "../src/components/utils/core/roles.constants.js";
import { validateFile, inspectParseResult, transformHeader, MAX_SIZE_B } from "../src/lib/csvIntake.js";
import { runAnalysis, runAnalysisSync } from "../src/lib/runAnalysis.js";
import { normalizeValue, valueFrequencies, cramersV, mutualInformation, toNumber, quantile, median,
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
  survives(() => getVisualizations(bigRows, bigCols, ["measure"], ["flag"],
                                   getStatistics(bigRows, ["measure"]))));

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

/* Text ids: a numeric target is regression and has no classes at all (10b). */
const idTextRows = idRows.map(r => ({ ...r, pid: `p${r.pid}` }));
check("a target with thousands of distinct classes still returns finite class balance",
  (() => { const r = analyzeDataset(idTextRows, ["pid", "v"], "pid");
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
// qualityScore is READ by health.js now, not recomputed from these fields.
const scoringQuality  = { missingPct: 0, columnsWithIssues: [], duplicatesComputed: true, duplicateRows: 0,
                          qualityScore: 100, worstMissingColumn: null };
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

/* Cancelling needs a Worker to cancel, so a stand-in is installed for this one
   check: it never answers, which is exactly a long analysis still running. */
let terminated = false;
globalThis.Worker = class { postMessage() {} terminate() { terminated = true; } };
const controller = new AbortController();
const cancelled  = runAnalysis(wRows, ["a", "b", "y"], "y", undefined, controller.signal);
controller.abort();
const cancelRun  = await cancelled;
delete globalThis.Worker;
check("aborting a running analysis terminates the worker and settles as aborted, not failed",
  terminated && cancelRun.aborted === true && cancelRun.result === null && cancelRun.error === null);

/* ── Chi-square over the WHOLE contingency table ──────────────────────────
   A cell that was never observed still has a non-zero expectation, and it
   contributes exactly that expectation to chi-square. Summing only over the
   cells that occurred understates the statistic, and it does so worst on SPARSE
   tables — which is precisely where the association is strongest. Measured on
   the real ginf.csv before the fix: "league" and "country" are a perfect 1:1
   map (5 leagues, 5 countries, 5 of 25 cells occupied) and V came back 0.8946
   instead of 1.0000, so a deterministic relationship read as merely "strong". */
console.log("\nCHI-SQUARE — empty contingency cells\n");

const diagA = [], diagB = [];
for (let lvl = 0; lvl < 5; lvl++) {
  for (let i = 0; i < 400; i++) { diagA.push(`L${lvl}`); diagB.push(`C${lvl}`); }
}
const diag = cramersV(diagA, diagB);
check("a perfect 1-to-1 mapping over a sparse table scores V = 1",
  Math.abs(diag.v - 1) < 1e-9);

// Independence must stay at 0: the empty-cell term is an addition to chi-square,
// so the risk it introduces is inflating an association that is not there.
const indA = [], indB = [];
for (let i = 0; i < 4000; i++) { indA.push(`a${i % 4}`); indB.push(`b${Math.floor(i / 4) % 5}`); }
check("a fully crossed, independent table still scores V = 0",
  cramersV(indA, indB).v === 0);

/* Both call sites, one estimator. relations.js used to carry its own copy of the
   contingency table + Bergsma correction, which is how the two came to disagree:
   fixing one left the other reporting the old number against the TARGET, the
   place the value is most likely to be acted on. */
const cvRows = [];
for (let lvl = 0; lvl < 4; lvl++) {
  for (let i = 0; i < 250; i++) cvRows.push({ f: `L${lvl}`, t: `T${lvl}` });
}
const cvRel = getRelationshipsV3(cvRows, [], "t", new Set(), ["f"]);
check("the target branch reports the same V as the shared estimator",
  cvRel.targetCorrelations.f?.metric === "cramers_v" && cvRel.targetCorrelations.f.value === 1);

/* ── One string-to-number policy ───────────────────────────────────────────
   isNumeric() rejects "125+"; parseFloat() turns it into 125. The engine gated
   on the first and measured with the second, so a super-heavyweight weight class
   was silently rewritten to its own lower bound and averaged in. Measured on
   openpowerlifting.csv: 25,813 of 382,602 values, mean 88.53 where the numbers
   alone give 86.78. */
console.log("\nNUMERIC POLICY — no silent coercion of a numeric prefix\n");

check('toNumber() refuses a numeric prefix that isNumeric() refuses',
  Number.isNaN(toNumber("125+")) && Number.isNaN(toNumber("12kg")) && Number.isNaN(toNumber("1,234")));

check("toNumber() still reads the numbers isNumeric() accepts",
  toNumber("125") === 125 && toNumber(" 1.5 ") === 1.5 && toNumber("1e3") === 1000);

/* 90% clean, 10% written with a "+" suffix. The column is still analysed as
   numeric — that is deliberate — but the suffixed values must not be counted. */
const mixRows = [];
for (let i = 0; i < 90; i++) mixRows.push({ w: "100", y: String(i % 2) });
for (let i = 0; i < 10; i++) mixRows.push({ w: "200+", y: String(i % 2) });
const mixStats = getStatistics(mixRows, ["w"])[0];
check("a suffixed value is excluded from the statistics, not truncated",
  mixStats.count === 90 && mixStats.mean === 100 && mixStats.max === 100);

const mixQuality = getQuality(mixRows, ["w", "y"], [], []);
const mixIssue = mixQuality.columnsWithIssues.find(i => i.issue === "mixed_numeric");
check("the excluded values are REPORTED, with their count and an example",
  mixIssue?.col === "w" && mixIssue.count === 10 && mixIssue.detail.includes('"200+"'));

/* Below the numeric share the column is analysed as categorical instead, so
   nothing is discarded and there is nothing to warn about. */
const catRows = mixRows.map((r, i) => ({ ...r, w: i % 2 ? "200+" : "100" }));
check("a column that is not analysed as numeric raises no exclusion warning",
  !getQuality(catRows, ["w", "y"], [], []).columnsWithIssues.some(i => i.issue === "mixed_numeric"));

/* ── Nothing leaves the target scan silently ───────────────────────────────
   A column the scan cannot measure used to vanish: absent from
   targetCorrelations, absent from excludedColumns, absent from every
   observation. On smoking.csv that hid three PERFECT predictors — "type",
   "amt_weekends" and "amt_weekdays" are missing on exactly the 1,270 rows where
   smoke = "No", so their presence alone decides the target — while the report
   announced "Weak feature-target associations. Strongest: age (0.22)". */
console.log("\nUNSCORED COLUMNS — no column disappears without a reason\n");

/* "amt" is present only on the rows where y = "yes": exactly the shape above. */
const mnarRows = [];
for (let i = 0; i < 200; i++) mnarRows.push({ amt: String(10 + (i % 7)), grp: `g${i % 3}`, y: "yes" });
for (let i = 0; i < 200; i++) mnarRows.push({ amt: "", grp: `g${i % 3}`, y: "no" });

const mnar = getRelationshipsV3(mnarRows, ["amt"], "y", new Set(), ["grp"]);
const amtDrop = mnar.unscoredColumns.find(u => u.col === "amt");
check("a column whose presence tracks the target is recorded, not dropped",
  !!amtDrop && !("amt" in mnar.targetCorrelations));

/* The reason must end with the MEASURED verdict, not a suggestion to go and test
   something the engine tests itself two blocks later. On events.csv the old
   wording told the reader to try "player_in_present" while the measurement
   already in hand said that indicator scores 0.03. */
check("the reason ends with the measured presence verdict, not a suggestion to test it",
  /recorded at all/i.test(amtDrop?.reason ?? "")
  && amtDrop.reason.includes("1.00")
  && !/worth testing/i.test(amtDrop.reason));

check("the observations name the columns that were left out",
  mnar.observations.some(o => o.includes("left out of the target scan") && o.includes('"amt"')));

/* The engine must not start inventing exclusions for columns it CAN measure. */
const okRows = [];
for (let i = 0; i < 200; i++) okRows.push({ n: String(i % 50), y: i % 2 ? "yes" : "no" });
check("a measurable column is not reported as unscored",
  getRelationshipsV3(okRows, ["n"], "y", new Set(), []).unscoredColumns.length === 0);

/* A column that is 99.7% empty is not 100% empty, and a user who reads "100%"
   and deletes it has been told something false. */
const nearlyEmpty = [];
for (let i = 0; i < 1000; i++) nearlyEmpty.push({ a: i < 3 ? "5" : "", b: String(i % 4), y: String(i % 2) });
const nearlyEmptyLimit = analyzeDataset(nearlyEmpty, ["a", "b", "y"], "y").healthScore.limits
  .find(l => l.reason.includes('"a"'));
check("a column with a few real values is never called 100% empty",
  !!nearlyEmptyLimit && !nearlyEmptyLimit.reason.includes("100%") && nearlyEmptyLimit.reason.includes("99.7%"));

/* Same rule in the advice and the cards — they rounded 99.7 to 100 on their own. */
const nearlyEmptyRes = analyzeDataset(nearlyEmpty, ["a", "b", "y"], "y");
check("the recommendations and cards do not call it 100% either",
  [...nearlyEmptyRes.recommendations.map(r => r.issue + r.action + r.rationale), ...nearlyEmptyRes.insights.map(i => i.title + i.text)]
    .every(t => !t.includes("100%")) && nearlyEmptyRes.recommendations.some(r => r.issue.includes("99.7%")));

/* ── The presence of a value as its own variable ───────────────────────────
   The engine advised building a "<col>_present" indicator for mostly-empty
   columns and justified it with "often correlates with something meaningful" —
   a claim about datasets in general, standing in for the answer about THIS one,
   which is a single contingency table away. On smoking.csv the answer is total:
   the indicator separates the target perfectly while the report was calling the
   strongest association 0.22. */
console.log("\nPRESENCE SIGNAL — missingness measured, not asserted\n");

const presRows = [];
for (let i = 0; i < 300; i++) presRows.push({ amt: String(10 + (i % 9)), keep: String(i % 20), y: "yes" });
for (let i = 0; i < 300; i++) presRows.push({ amt: "", keep: String(i % 20), y: "no" });

const pres = analyzeDataset(presRows, ["amt", "keep", "y"], "y");
const amtSignal = pres.relationships.presenceSignals.find(p => p.col === "amt");
check("a perfectly target-aligned missingness is measured at V = 1",
  amtSignal?.cramersV === 1 && amtSignal.n === 600);

check("a column with no missing rows produces no presence signal",
  !pres.relationships.presenceSignals.some(p => p.col === "keep"));

check("the presence finding reaches the observations",
  pres.relationships.observations.some(o => o.includes("recorded at all") && o.includes('"amt"')));

check("the recommendation quotes the measured association instead of asserting one",
  pres.recommendations.some(r => r.column === "amt" && (r.action + r.rationale).includes("1.00")
                              && !r.rationale.includes("often correlates")));

/* Missingness unrelated to the target must NOT produce a signal — the measure
   has to be able to say no, or it is just the old assertion with a number on it. */
const noiseRows = [];
for (let i = 0; i < 600; i++) noiseRows.push({ amt: i % 3 === 0 ? "" : String(i % 11), y: i % 2 ? "yes" : "no" });
check("missingness unrelated to the target reports no presence signal",
  analyzeDataset(noiseRows, ["amt", "y"], "y").relationships.presenceSignals.length === 0);

/* A column dropped for a constant target whose indicator ALSO carries nothing has
   to say so. Reporting only the half that found something is how the report came
   to recommend an indicator its own measurement had already ruled out. */
/* The events.csv shape: "v" is present on a slice whose target is constant, but
   the target is overwhelmingly that same value everywhere, so knowing the value
   was recorded adds nothing over the base rate. */
const deadRows = [];
for (let i = 0; i < 100; i++) deadRows.push({ v: String(i % 5), y: "a" });
for (let i = 0; i < 900; i++) deadRows.push({ v: "", y: i < 8 ? "b" : "a" });
const deadDrop = getRelationshipsV3(deadRows, ["v"], "y", new Set(), [])
  .unscoredColumns.find(u => u.col === "v");
check("a column whose presence carries nothing says so instead of recommending it",
  !!deadDrop && /no usable signal/i.test(deadDrop.reason) && !deadDrop.reason.includes("Build "));

/* ── Leakage that is not a Pearson r ───────────────────────────────────────
   Leakage detection was Pearson-only because an uncorrected Cramér's V climbed
   toward 1.0 on cardinality alone. Bergsma and the empty-cell fix removed that,
   so V = 1.0 now means a functional dependency — which is what leakage is.
   Measured: meets.csv "MeetCountry" determines "MeetState" at 0.99 and was never
   flagged; smoking.csv's "type" is filled in only for smokers, so whether it was
   recorded at all IS the label. */
console.log("\nLEAKAGE — not every leak is a correlation coefficient\n");

/* A categorical feature that determines the target one-to-one. */
const detRows = [];
for (let lvl = 0; lvl < 6; lvl++) {
  for (let i = 0; i < 200; i++) detRows.push({ code: `c${lvl}`, noise: `n${i % 4}`, y: `t${lvl}` });
}
const detLeak = getRelationshipsV3(detRows, [], "y", new Set(), ["code", "noise"]).leakageSuspects;
check("a categorical column that determines the target is flagged as leakage",
  detLeak.some(l => l.col === "code" && l.metric === "cramers_v"));

check("an unrelated categorical column is not flagged",
  !detLeak.some(l => l.col === "noise"));

/* Missingness that restates the label: present for one class, empty for the
   other. These columns have no targetCorrelations entry at all, so the loop over
   it can never reach them. */
const leakPresence = analyzeDataset(presRows, ["amt", "keep", "y"], "y").relationships.leakageSuspects;
check("missingness that restates the label is flagged as leakage",
  leakPresence.some(l => l.col === "amt" && l.metric === "presence"));

/* Consumers must not re-compose the message assuming Pearson — that printed
   "r = 0.99" for a Cramér's V, which is a different statistic. */
const detInsights = analyzeDataset(detRows, ["code", "noise", "y"], "y");
check("the leakage message is not relabelled as an r by the insight that renders it",
  detInsights.insights.some(i => i.title.includes("Leakage") && i.text.includes("Cramér")
                              && !/\br = /.test(i.text)));

/* ── Coverage ──────────────────────────────────────────────────────────────
   A coefficient is a claim about the rows it was computed on. openpowerlifting
   reported "Strongest: Squat4Kg (0.16)" — 1,225 of 386,414 rows, 0.3% — while
   Equipment scored 0.14 across 99.7% of them. */
console.log("\nCOVERAGE — a number measured on a slice says so\n");

/* The openpowerlifting shape: "narrow" scores higher but is present on 5% of
   rows, while "broad" covers everything at a slightly lower score. */
const covRows = [];
for (let i = 0; i < 4000; i++) {
  const y = i % 2;
  covRows.push({
    narrow: i < 200 ? String((i % 10) < 6 ? y : 1 - y) : "",   // r ~ 0.20 on 200 rows
    broad:  String((i % 100) < 57 ? y : 1 - y),                // r ~ 0.14 on all 4000
    y:      String(y),
  });
}
const covObs = analyzeDataset(covRows, ["narrow", "broad", "y"], "y").relationships.observations
  .find(o => o.startsWith("Weak feature-target associations"));

// Guard the fixture itself: without this line the two checks below pass vacuously
// if the observation ever stops being produced.
check("the fixture reaches the weak-signal observation at all", !!covObs);

check("the strongest-signal line names the share of rows behind a narrow measurement",
  /"narrow"/.test(covObs ?? "") && /200 of 4000 rows/.test(covObs ?? "") && /5\.0% of the dataset/.test(covObs ?? ""));

check("it names the best broadly-measured feature beside the narrow one",
  /"broad"/.test(covObs ?? "") && /over 4000 rows/.test(covObs ?? ""));

/* ── Column roles ──────────────────────────────────────────────────────────
   Three separate defects, all about a column being routed as something it is
   not. Measured on events.csv (941,009 rows, ships a published data dictionary)
   and meets/ginf. */
console.log("\nCOLUMN ROLES — free text, string keys, and codes that look like counts\n");

const sentence = i => `Attempt missed. Player ${i % 700} takes a left footed shot from outside the box, high and wide to the left.`;
const textRows = [];
for (let i = 0; i < 800; i++) {
  textRows.push({
    note: sentence(i),                                  // ~110 chars, spaces, ~700 distinct
    url:  `/soccer/germany/match-${i}-abcdef/`,          // long, unique, NO spaces
    name: `Player Number ${i % 90}`,                     // spaces, but short
    y:    String(i % 2),
  });
}
const textRoles = detectColumnRoles(textRows, ["note", "url", "name", "y"], "y");
check("a commentary column is read as free text, not as a category",
  textRoles.note === ROLE.TEXT);

check("a long unique string with no spaces is an identifier, not free text",
  textRoles.url === ROLE.IDENTIFIER);

check("a short spaced label stays categorical",
  textRoles.name === ROLE.CATEGORICAL);

/* Free text used to become the strongest reported association with the target,
   because the commentary describes the event it was being correlated against. */
const textAnalysis = analyzeDataset(textRows, ["note", "url", "name", "y"], "y");
check("free text is kept out of the target scan",
  !("note" in textAnalysis.relationships.targetCorrelations)
  && textAnalysis.meta.textCols.includes("note"));

check("and it says so rather than simply vanishing",
  textAnalysis.relationships.unscoredColumns.some(u => u.col === "note" && /free text/i.test(u.reason)));

/* An identifier or a date was skipped from the target scan with no trace at all
   — ginf.csv's "id_odsp" and "date" were absent from the tab with no reason. */
check("an identifier skipped from the scan is named with its reason",
  textAnalysis.relationships.unscoredColumns.some(u => u.col === "url" && /identifier/i.test(u.reason)));

/* A string key with no telltale name: one distinct value per row, measured over
   the whole column, not a 200-row head. */
const keyRows = [];
for (let i = 0; i < 300; i++) keyRows.push({ slug: `aa/bb/${i}-${i * 7}`, grp: `g${i % 5}`, y: String(i % 2) });
check("a string key with no id-like name is an identifier",
  detectColumnRoles(keyRows, ["slug", "grp", "y"], "y").slug === ROLE.IDENTIFIER);

/* ...and the two detectors that used to disagree about it now agree. */
const keyQuality = analyzeDataset(keyRows, ["slug", "grp", "y"], "y");
check("quality no longer calls the same column 'likely an ID' while roles call it categorical",
  !keyQuality.quality.columnsWithIssues.some(i => i.issue === "high_cardinality" && i.col === "slug"));

/* Codes that look like counts: the ceiling stays at 4, but the ambiguity is
   stated. events.csv's event_type is 12 codes and the report said mean = 4.33. */
const codeRows = [];
for (let i = 0; i < 600; i++) {
  codeRows.push({
    code:  String(1 + (i % 12)),        // 12 gapless integers from 1 — the events shape
    spread: String((i % 24) * 3),        // 24 integers, gaps everywhere — a real count
    y:     String(i % 2),
  });
}
const codeQuality = analyzeDataset(codeRows, ["code", "spread", "y"], "y").quality.columnsWithIssues;
check("a gapless run of small integers is reported as possibly coded",
  codeQuality.some(i => i.issue === "possible_code" && i.col === "code" && /1 to 12/.test(i.detail)));

check("a column with gaps is not reported as coded",
  !codeQuality.some(i => i.issue === "possible_code" && i.col === "spread"));

/* The ceiling itself did not move: a 12-level integer column is still NUMERIC,
   so it keeps the mean/std/outliers a genuine count needs. */
check("the encoded-categorical ceiling did not move",
  detectColumnRoles(codeRows, ["code", "spread", "y"], "y").code === ROLE.NUMERIC);

/* ── One quality number, and caps that still distinguish ───────────────────
   Two quality models existed — a flat "100 minus penalties" in quality.js and a
   weighted average in health.js, from the same inputs. They disagreed openly:
   11 vs 40 on openpowerlifting.csv, 7 vs 39 on events.csv. */
console.log("\nONE QUALITY NUMBER — and a cap that does not flatten\n");

const qRows = [];
for (let i = 0; i < 400; i++) qRows.push({ a: i < 300 ? "" : String(i), b: `g${i % 6}`, y: String(i % 2) });
const qResult = analyzeDataset(qRows, ["a", "b", "y"], "y");

check("the health quality dimension is the published quality score, not a second one",
  qResult.healthScore.breakdown.quality === qResult.quality.qualityScore);

check("the waterfall the report shows adds up to the score it states",
  qResult.quality.qualityScore
    === 100 - qResult.quality.scorePenalties.reduce((s, p) => s + p.penalty, 0));

check("the removed duplicate breakdown is gone from healthScore",
  !("qualityBreakdown" in qResult.healthScore));

/* A flat cap erased the difference it existed to express: ginf (worst column
   90.3% empty, weighted 80.4) and openpowerlifting (99.7% empty, weighted 64.1)
   both landed on exactly 55 — the worse file scoring the same as the better one. */
const capAt = (emptyPct) => {
  const rows = [];
  const empties = Math.round(400 * emptyPct);
  for (let i = 0; i < 400; i++) {
    rows.push({ sparse: i < empties ? "" : String(i % 40), b: `g${i % 6}`, c: String(i % 31), y: String(i % 2) });
  }
  return analyzeDataset(rows, ["sparse", "b", "c", "y"], "y").healthScore;
};
const bad   = capAt(0.90);
const worse = capAt(0.99);
check("a worse worst-column produces a strictly lower ceiling",
  worse.limits[0].max < bad.limits[0].max);

check("and a strictly lower score, instead of both landing on the same number",
  worse.score < bad.score);

check("the cap states the number it holds the score to",
  bad.limits[0].reason.includes(String(bad.limits[0].max)));

/* An unnamed header — a pandas/R index column — used to reach the reader as
   `Drop "" before training`. Renamed at intake, before rows are keyed. */
check("a blank header is named at intake",
  transformHeader("", 0) === "column_1" && transformHeader("  ", 4) === "column_5");

check("a real header is left exactly as it is",
  transformHeader("Age", 2) === "Age");

/* ── Performance work must not change a single number ──────────────────────
   Four changes: one sort per column instead of four, visualizations read from
   the statistics rows instead of recomputing them, each numeric column parsed
   once instead of once per pair, and flat arrays instead of an array of pairs.
   Measured on openpowerlifting.csv (386,414 x 17): 34.9s → 18.1s. Every one of
   them is an identity — so the thing worth locking is that the output did not
   move, and that the two tabs that describe the same column still agree. */
console.log("\nPERFORMANCE — same numbers, less work\n");

const perfRows = [];
for (let i = 0; i < 3000; i++) {
  perfRows.push({
    a: String((i * 37) % 500 + (i % 3) / 3),
    b: String(Math.round(Math.sin(i) * 1000) / 10),
    c: `g${i % 9}`,
    y: String(i % 2),
  });
}
const perf = analyzeDataset(perfRows, ["a", "b", "c", "y"], "y");
const statA = perf.statistics.find(s => s.col === "a");
const vizA  = perf.visualizations.find(v => v.col === "a");

check("the boxplot and the statistics row report the same quartiles",
  vizA.boxplot.q1 === statA.q1 && vizA.boxplot.q3 === statA.q3
  && vizA.boxplot.median === statA.median && vizA.boxplot.min === statA.min
  && vizA.boxplot.max === statA.max);

check("the two tabs report the same outlier count and histogram",
  vizA.boxplot.outlierCount === statA.outlierCount
  && JSON.stringify(vizA.histogram) === JSON.stringify(statA.histogram));

/* The skew LABEL was computed from a rounded value in one place and an unrounded
   one in the other, so the two tabs could describe the same column differently. */
check("the distribution wording agrees with the statistics label",
  (statA.skewnessLabel === "Symmetric") === /approximately symmetric/.test(vizA.insight));

/* quantile()/median() keep working on an unsorted array — the sorted forms are
   an addition, not a replacement, and outside callers still pass raw values. */
check("quantile() and median() still sort for callers that hand them raw values",
  quantile([9, 1, 5, 3, 7], 0.5) === 5 && median([9, 1, 5, 3, 7]) === 5);

/* The phase callback is optional and cannot change the result — the engine has
   to stay a pure function of its inputs. */
const seen = [];
const withPhases = analyzeDataset(perfRows, ["a", "b", "c", "y"], "y", p => seen.push(p.id));
check("the phase callback reports every phase, in order",
  seen.length === ANALYSIS_PHASES.length
  && seen.every((id, i) => id === ANALYSIS_PHASES[i].id));

check("and announcing the phases does not change the result",
  JSON.stringify(withPhases) === JSON.stringify(perf));

/* ══════════════════════════════════════════
   STAGE 10a — the target scan reads the roles
══════════════════════════════════════════ */
console.log("\nTARGET SCAN — one type system, one missing policy\n");

/* house_prices.csv: a 3-level Furnishing against a numeric price scored
   Cramér's V 0.73, because every distinct price became a contingency column.
   The true η is 0.005. Here the level is unrelated to y by construction. */
const furnRows = Array.from({ length: 3000 }, (_, i) => ({
  furn: ["furnished", "semi", "unfurnished"][i % 3],
  y:    String((i * 7919) % 2999 + 0.5),
}));
const furn = getRelationshipsV3(furnRows, [], "y", new Set(), ["furn"]).targetCorrelations.furn;
check("a categorical feature against a numeric target is measured with η, not Cramér's V",
  furn?.metric === "eta" && furn.value < 0.1);

/* "NA" is missing everywhere else in the engine. The scan counted it as a value,
   so 30% "NA" dropped a numeric target under the 80% numeric share. */
const naTargetRows = Array.from({ length: 1000 }, (_, i) => ({
  x: String((i * 37) % 1000),
  y: i % 10 < 3 ? "NA" : String(((i * 37) % 1000) * 2 + (i % 7)),
}));
const naTargetX = getRelationshipsV3(naTargetRows, ["x"], "y", new Set(), []).targetCorrelations.x;
check("missing tokens in a numeric target do not turn it categorical",
  naTargetX?.metric === "pearson" && naTargetX.value > 0.99 && naTargetX.n === 700);

/* η grows with the number of groups alone; the grouping side is now a feature,
   which can have thousands of levels. 500 levels, 2 rows each, unrelated y. */
const manyRows = Array.from({ length: 1000 }, (_, i) => ({
  g: `lvl${Math.floor(i / 2)}`, y: String(Math.floor(Math.abs(Math.sin(i + 1)) * 1e6) % 1000),
}));
const many = getRelationshipsV3(manyRows, [], "y", new Set(), ["g"]).targetCorrelations.g;
check("η against a many-level feature is bias-corrected, not inflated by cardinality",
  many?.metric === "eta" && many.value < 0.3);

/* A date target has no statistic here; a number would look real and mean nothing. */
const dateRows = Array.from({ length: 200 }, (_, i) => ({
  f: `c${i % 4}`, d: `2024-01-${String(i % 28 + 1).padStart(2, "0")}`,
}));
const dateRel = getRelationshipsV3(dateRows, [], "d", new Set(), ["f"]);
check("a date target is not scored — every column says why",
  Object.keys(dateRel.targetCorrelations).length === 0
  && dateRel.unscoredColumns.some(u => u.col === "f" && u.reason.includes("is a date")));

/* ══════════════════════════════════════════
   STAGE 10b — the target is not a feature
══════════════════════════════════════════ */
console.log("\nTARGET HANDLING — regression, missing, constant, per-row-unique\n");

/* ai_student: Post_Semester_GPA reported 2,269 "classes" and a class-imbalance
   warning on a regression problem. */
const gpaRows = Array.from({ length: 600 }, (_, i) => ({
  hours: String(i % 37), gpa: (2 + ((i * 7919) % 200) / 100).toFixed(2),
}));
const gpa = analyzeDataset(gpaRows, ["hours", "gpa"], "gpa");
check("a numeric target has no class balance and no imbalance advice",
  gpa.classBalance === null
  && !gpa.recommendations.some(r => /imbalance/i.test(r.issue))
  && !gpa.insights.some(i => /imbalance/i.test(i.title)));

/* "Impute Price with median" invents the answer the model is graded against. */
const missTargetRows = gpaRows.map((r, i) => ({ ...r, gpa: i % 10 === 0 ? "" : r.gpa }));
const missTarget = analyzeDataset(missTargetRows, ["hours", "gpa"], "gpa").recommendations
  .filter(r => r.column === "gpa" && /missing/i.test(r.issue));
check("a missing target is dropped, never imputed",
  missTarget.length === 1 && /do not impute/i.test(missTarget[0].action) && !/^Impute/.test(missTarget[0].action));

/* A single-valued target was told to be dropped as a constant column and to be
   oversampled with SMOTE. */
const constRows = Array.from({ length: 300 }, (_, i) => ({ f: String(i % 9), y: "yes" }));
const constRes = analyzeDataset(constRows, ["f", "y"], "y");
check("a constant target is flagged, capped, and gets no feature-style advice",
  constRes.meta.targetIsConstant
  && constRes.healthScore.score <= 25
  && constRes.recommendations.some(r => r.issue === "Target never varies")
  && !constRes.recommendations.some(r => /SMOTE|Constant column|imbalance/i.test(r.issue + r.action))
  && Object.keys(constRes.relationships.targetCorrelations).length === 0
  && constRes.insights[0]?.title === "Target Never Varies"
  && constRes.meta.datasetType === "Unknown");

/* Titanic "Name" as target: not a name/sequence identifier, but 100% distinct. */
const nameRows = Array.from({ length: 300 }, (_, i) => ({ f: String(i % 4), who: `Person ${i}, Mr.` }));
const nameRes = analyzeDataset(nameRows, ["f", "who"], "who");
check("a per-row-unique text target is an identifier, not a 300-class problem",
  nameRes.meta.targetIsIdentifier
  && !nameRes.recommendations.some(r => r.column === "who" && /Group rare/i.test(r.action)));

/* ══════════════════════════════════════════
   STAGE 10c — advice that does not contradict itself
══════════════════════════════════════════ */
console.log("\nCONSISTENT ADVICE — one decision per column\n");

/* presRows: "amt" is present only where y = "yes" — a presence leak at V = 1. */
const leakAdvice = analyzeDataset(presRows, ["amt", "keep", "y"], "y");
const amtRecs = leakAdvice.recommendations.filter(r => r.column === "amt");
check("a presence leak is labelled with its own statistic, not r",
  amtRecs.some(r => /presence = 1\.00/.test(r.issue)) && !amtRecs.some(r => /\(r = /.test(r.issue)));
check("a leaking column is not also advised to be built into an indicator or imputed",
  amtRecs.length === 1 && amtRecs[0].category === "Data Integrity");
check("the observations do not tell the reader to build the leaking indicator",
  !leakAdvice.relationships.observations.some(o => /build "amt_present" rather than/.test(o)));

/* An empty column has no presence to encode — the indicator would be constant. */
const emptyRows = Array.from({ length: 200 }, (_, i) => ({ blank: "", f: String(i % 7), y: i % 2 ? "a" : "b" }));
const blankRecs = analyzeDataset(emptyRows, ["blank", "f", "y"], "y").recommendations.filter(r => r.column === "blank");
check("an empty column is dropped, not turned into a presence indicator",
  blankRecs.length === 1 && /no values at all/.test(blankRecs[0].action));

/* V is symmetric, dependency is not: 60 fine levels each map to one of 3 coarse
   ones. "Keep one of the two" would lose the fine column's detail. */
const dirRows = Array.from({ length: 1200 }, (_, i) => ({
  fine: `s${i % 60}`, coarse: `c${(i % 60) % 3}`, y: String((i * 7919) % 13),
}));
const dirRecs = analyzeDataset(dirRows, ["fine", "coarse", "y"], "y").recommendations;
check("an uneven categorical dependency names its direction instead of 'keep one of'",
  dirRecs.some(r => r.column === "fine" && /largely determines/.test(r.issue))
  && !dirRecs.some(r => /Keep one of/.test(r.action)));

/* Three columns with a few missing cells each: one item, not three. */
const lightRows = Array.from({ length: 400 }, (_, i) => ({
  a: i % 50 === 0 ? "" : String(i % 11), b: i % 40 === 0 ? "" : String(i % 13),
  c: i % 60 === 0 ? "" : ["x", "z", "w"][i % 3], y: i % 2 ? "p" : "q",
}));
const lightRecs = analyzeDataset(lightRows, ["a", "b", "c", "y"], "y").recommendations
  .filter(r => /missing/i.test(r.issue));
check("lightly-missing columns are grouped into one recommendation",
  lightRecs.length === 1 && lightRecs[0].issue.includes("3 columns"));

/* Pair advice about columns the report already replaces is a contradiction. */
const pairRows = Array.from({ length: 400 }, (_, i) => {
  const v = i % 5 === 0 ? String(i) : "";
  return { p1: v, p2: v === "" ? "" : String(Number(v) * 2 + 1), f: String(i % 9), y: i % 2 ? "p" : "q" };
});
const pairRecs = analyzeDataset(pairRows, ["p1", "p2", "f", "y"], "y").recommendations;
check("columns replaced by presence indicators get no pair advice",
  pairRecs.some(r => r.column === "p1" && /_present/.test(r.action))
  && !pairRecs.some(r => /"p1" ↔ "p2"|"p1" or "p2"/.test(r.issue + r.action)));

/* ══════════════════════════════════════════
   STAGE 10d — the target guess only offers usable columns
══════════════════════════════════════════ */
console.log("\nTARGET DETECTION — never suggest a column 10b would refuse\n");

/* house_prices.csv: "Status" matched by name and holds one value plus blanks. */
const guessRows = Array.from({ length: 300 }, (_, i) => ({
  Status: i % 50 === 0 ? "" : "Ready to Move",
  "Price (in rupees)": String(3000 + (i * 7919) % 9000),
  marital_status: ["single", "married", "divorced"][i % 3],
  smoke: i % 4 ? "No" : "Yes",
}));
check("a constant column is never the guess, even when its name matches",
  detectTarget(Object.keys(guessRows[0]), guessRows) === "Price (in rupees)");

/* smoking.csv: "status" inside "marital_status" is a feature, not a target name. */
const noPrice = guessRows.map(({ Status, smoke, marital_status }) => ({ Status, marital_status, smoke }));
check("a target word inside a feature name does not win ('marital_status')",
  detectTarget(Object.keys(noPrice[0]), noPrice) === "smoke");

check("a target word inside a name is matched when it is unambiguous ('price_range')",
  detectTarget(["ram", "price_range", "wifi"],
    Array.from({ length: 100 }, (_, i) => ({ ram: String(i * 13), price_range: String(i % 4), wifi: String(i % 2) }))) === "price_range");

/* meets.csv: nothing looks like a target, and the fallback was an identifier-like name column. */
const noTarget = Array.from({ length: 400 }, (_, i) => ({ MeetID: String(i), region: `r${i % 30}`, MeetName: `Meet number ${i % 300}` }));
check("the fallback is never an identifier or a many-level name column",
  !["MeetID", "MeetName"].includes(detectTarget(Object.keys(noTarget[0]), noTarget)));

/* ══════════════════════════════════════════
   STAGE 10d — keys and entities are not features
══════════════════════════════════════════ */
console.log("\nKEYS AND ENTITIES — foreign keys, and Sex↔Name\n");

/* openpowerlifting.csv "MeetID": 8,482 repeated integers keyed into meets.csv.
   Unique-per-row detection missed it, so it got a mean and a histogram. */
const fkRows = Array.from({ length: 2000 }, (_, i) => ({
  MeetID: String(Math.floor(i / 7)), store_id: String(i % 12), weight: String(50 + (i * 37) % 90), y: String(i % 2),
}));
const fkRoles = detectColumnRoles(fkRows, ["MeetID", "store_id", "weight", "y"], "y");
check("a repeated key named as an id is an identifier, not a measurement",
  fkRoles.MeetID === ROLE.IDENTIFIER);
check("a key with a handful of groups is categorical, never numeric",
  fkRoles.store_id === ROLE.CATEGORICAL && fkRoles.weight === ROLE.NUMERIC);

/* openpowerlifting.csv: 136,687 lifter names determine each lifter's sex, and the
   report said "Keep one of Name or Sex" — reproduced verbatim on 8d02d07. */
const lifterRows = Array.from({ length: 1500 }, (_, i) => {
  const person = Math.floor(i / 3);
  return { Name: `Lifter ${person}`, Sex: person % 2 ? "M" : "F", Equipment: ["Raw", "Wraps"][i % 2], Place: String((i * 7919) % 9) };
});
const lifter = analyzeDataset(lifterRows, ["Name", "Sex", "Equipment", "Place"], "Place");
check("an entity too fine to learn from is not offered as the column to keep",
  lifter.recommendations.some(r => r.column === "Name" && /too fine/.test(r.issue) && /Keep "Sex"/.test(r.action))
  && !lifter.recommendations.some(r => /Keep one of "Name" or "Sex"|If you keep "Name"/.test(r.action)));
check("the association statement names its direction",
  lifter.relationships.categoricalAssociations.some(a => a.statement.includes('"Name" largely determines "Sex"')));

/* ══════════════════════════════════════════
   STAGE 10d — an outlier cutoff that allows for skew
══════════════════════════════════════════ */
console.log("\nOUTLIER CUTOFF — a long tail is not a list of errors\n");

/* Titanic Fare shape: a smooth exponential tail. Tukey flagged ~13% of it. */
const tailRows = Array.from({ length: 1000 }, (_, i) => ({ fare: (-Math.log(1 - (i + 0.5) / 1000) * 20).toFixed(3) }));
const tailStat = getStatistics(tailRows, ["fare"])[0];
check("a smooth long tail is not flagged wholesale as outliers",
  tailStat.outlierCount / tailStat.count < 0.03 && tailStat.medcouple > 0);

/* One genuine error in the same tail must still be caught. */
const tailWithError = [...tailRows, { fare: "670000" }];
check("a genuine extreme value is still an outlier under the adjusted fences",
  getStatistics(tailWithError, ["fare"])[0].upperFence < 670000);

/* The advice must cap at the cutoff that flagged the values, not a different one. */
const skewAdvice = analyzeDataset(
  Array.from({ length: 1000 }, (_, i) => ({ v: i % 9 === 0 ? String(5000 + i) : String(i % 97), y: String(i % 2) })),
  ["v", "y"], "y").recommendations.find(r => r.column === "v" && /outside/.test(r.action));
check("outlier advice quotes the fences it detected with, never a percentile cap",
  !!skewAdvice && !/percentile/.test(skewAdvice.action));

/* ══════════════════════════════════════════
   The insight cards follow the same decisions
══════════════════════════════════════════ */
console.log("\nINSIGHT CARDS — one decision per column, as in the recommendations\n");

/* presRows: "amt" leaks through its presence and is 50% empty. */
const leakCards = analyzeDataset(presRows, ["amt", "keep", "y"], "y").insights;
check("a leaking column has its leakage card and no separate missing-values card",
  leakCards.filter(i => i.text.includes('"amt"')).length === 1
  && leakCards.some(i => i.title === "Possible Target Leakage"));

/* Two columns carrying the same value and both >50% empty: the advice replaces
   both with indicators, so no card may tell the reader to drop one of the pair. */
const cardPairCards = analyzeDataset(pairRows, ["p1", "p2", "f", "y"], "y").insights;
check("no correlated-pair card for columns the advice already replaces",
  !cardPairCards.some(i => /Highly Correlated|Strong Feature Correlations|Feature Cluster/.test(i.title) && /"?p1"?/.test(i.text)));
check("columns sharing one missing-values message share one card",
  cardPairCards.filter(i => /Critical Missing Values/.test(i.title)).length === 1
  && cardPairCards.some(i => i.title === "Critical Missing Values in 2 Columns"));

/* ══════════════════════════════════════════
   STAGE 10e — one extreme value does not decide η
══════════════════════════════════════════ */
console.log("\nRANK η — an outlier neither creates nor hides an association\n");

/* house_prices.csv: one 6.7M price among values near 6,000 swamped the total
   variance, so location's plain η read 0.11 (rank-based 0.65). */
const etaOutRows = Array.from({ length: 900 }, (_, i) => ({
  zone: `z${i % 3}`, y: String(1000 * (i % 3) + ((i * 7919) % 400)),
}));
etaOutRows[5].y = "6700000";
const etaOut = getRelationshipsV3(etaOutRows, [], "y", new Set(), ["zone"]).targetCorrelations.zone;
check("a real group difference survives one extreme target value",
  etaOut?.metric === "eta" && etaOut.value > 0.8 && etaOut.pValue < 0.001);

/* ...and the row that isolates the outlier does not score as a predictor. */
const isoRows = etaOutRows.map((r, i) => ({ ...r, tag: i === 5 ? "odd" : `t${i % 40}` }));
const iso = getRelationshipsV3(isoRows, [], "y", new Set(), ["zone", "tag"]).targetCorrelations.tag;
check("a column that isolates the outlier row is not read as strongly associated",
  iso?.metric === "eta" && iso.value < 0.2);

/* ══════════════════════════════════════════
   HELD-OUT — defects found on files no threshold was tuned on
══════════════════════════════════════════ */
console.log("\nHELD-OUT — continuous measurements are not identifiers\n");

/* sonar.csv: 60 continuous signal columns, each >95% distinct, were flagged
   "likely an ID column" and advised to group rare categories — 36 times. */
const signalRows = Array.from({ length: 200 }, (_, i) => ({
  s1: (Math.abs(Math.sin(i + 1)) * 0.9).toFixed(4), s2: (Math.abs(Math.cos(i * 1.7)) * 0.8).toFixed(4), label: i % 2 ? "R" : "M",
}));
const signal = analyzeDataset(signalRows, ["s1", "s2", "label"], "label");
check("a near-unique numeric column is not called an ID or told to group rare categories",
  !signal.quality.columnsWithIssues.some(c => c.issue === "high_cardinality")
  && !signal.recommendations.some(r => /cardinality|Group rare/i.test(r.issue + r.action)));

/* ══════════════════════════════════════════
   ROLE OVERRIDES — a user decision is an input, recorded, never guessed
══════════════════════════════════════════ */
console.log("\nROLE OVERRIDES — accepted AI roles reach the engine as explicit inputs\n");

/* region is five integer codes: the engine reads it NUMERIC (ceiling 4 — see
   roles.js). A user who knows they are codes overrides it to CATEGORICAL. */
const overrideRows = Array.from({ length: 120 }, (_, i) => ({
  region: String((i % 5) + 1), spend: String(100 + ((i * 37) % 90)), churn: i % 3 ? "no" : "yes",
}));
const plain = analyzeDataset(overrideRows, ["region", "spend", "churn"], "churn");
const overridden = analyzeDataset(overrideRows, ["region", "spend", "churn"], "churn", undefined,
  { region: ROLE.CATEGORICAL, spend: "banana", ghost: ROLE.NUMERIC, churn: ROLE.BINARY });
check("without overrides the code column is numeric and nothing is recorded",
  plain.meta.columnRoles.region === ROLE.NUMERIC && Object.keys(plain.meta.roleOverrides).length === 0);
check("an override changes the role and reroutes the column",
  overridden.meta.columnRoles.region === ROLE.CATEGORICAL
  && overridden.meta.categoricalCols.includes("region") && !overridden.meta.numericCols.includes("region")
  && !overridden.statistics.some(r => r.col === "region"));
check("the applied override is recorded with the role it replaced",
  JSON.stringify(overridden.meta.roleOverrides) === JSON.stringify({ region: { from: ROLE.NUMERIC, to: ROLE.CATEGORICAL } }));
check("a non-ROLE value, an unknown column and a no-op override are ignored",
  overridden.meta.columnRoles.spend === ROLE.NUMERIC && !("ghost" in overridden.meta.columnRoles)
  && !("churn" in overridden.meta.roleOverrides));

console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"}`);
process.exit(failures === 0 ? 0 : 1);
