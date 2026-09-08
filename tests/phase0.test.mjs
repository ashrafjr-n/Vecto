/* phase0.test.mjs — plain Node, no framework.
   Verifies stdDev (sample, ddof=1) against the Python reference harness. */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { stdDev, skewness, kurtosis, isMissing } from "../src/components/utils/core/helpers.js";
import { getQuality } from "../src/components/utils/core/analyzers/quality.js";
import { analyzeDataset } from "../src/components/utils/core/index.js";
import { detectColumnRoles } from "../src/components/utils/core/detectors/roles.js";
import { getVisualizations } from "../src/components/utils/core/analyzers/stats.js";
import { getHealthScore } from "../src/components/utils/core/scoring/health.js";
import { etaCorrelation } from "../src/components/utils/core/helpers.js";
import { ROLE } from "../src/components/utils/core/roles.constants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOL = 1e-6;

const expected = JSON.parse(
  readFileSync(join(__dirname, "reference", "expected.json"), "utf8"),
);

/* tiny CSV parser — fine for the clean fixtures (no quoting/escaping) */
function parseCsv(path) {
  const lines = readFileSync(path, "utf8").trim().split(/\r?\n/);
  const header = lines[0].split(",");
  const rows = lines.slice(1).map(line => {
    const cells = line.split(",");
    const obj = {};
    header.forEach((h, i) => { obj[h] = cells[i]; });
    return obj;
  });
  return { header, rows };
}

const { header, rows } = parseCsv(
  join(__dirname, "reference", "datasets", "clean_numeric.csv"),
);

let failures = 0;

/* ── STEP 0 — UI enum-lock: locks the ROLE.* string values OverviewTab now
   depends on directly (numeric/categorical/binary/identifier/temporal). If
   roles.constants.js ever changes one of these strings, this fails loudly
   instead of the UI silently breaking (blank pills, empty role groups). ── */
console.log("STEP 0 — UI enum-lock (ROLE.* string values OverviewTab depends on)\n");

const enumLockChecks = [
  ['ROLE.NUMERIC === "numeric"',         ROLE.NUMERIC     === "numeric"],
  ['ROLE.CATEGORICAL === "categorical"', ROLE.CATEGORICAL === "categorical"],
  ['ROLE.BINARY === "binary"',           ROLE.BINARY      === "binary"],
  ['ROLE.IDENTIFIER === "identifier"',   ROLE.IDENTIFIER  === "identifier"],
  ['ROLE.TEMPORAL === "temporal"',       ROLE.TEMPORAL    === "temporal"],
];
for (const [msg, ok] of enumLockChecks) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
}

console.log("\nFix #1 — sample stdDev (ddof=1) vs reference harness\n");

for (const col of header) {
  const vals = rows.map(r => parseFloat(r[col])).filter(v => !isNaN(v));
  const actual = stdDev(vals);
  const want = expected.clean_numeric.columns[col].std;
  const diff = Math.abs(actual - want);
  const pass = diff <= TOL;
  if (!pass) failures++;
  console.log(
    `${pass ? "PASS" : "FAIL"}  ${col.padEnd(6)} ` +
    `actual=${actual.toFixed(12)}  expected=${want.toFixed(12)}  |diff|=${diff.toExponential(3)}`,
  );
}

/* ── Fix #2 — moment skewness + excess kurtosis vs reference harness ── */
const sk = parseCsv(
  join(__dirname, "reference", "datasets", "skew_kurt.csv"),
);

console.log("\nFix #2 — moment skewness (bias=False) + excess kurtosis vs reference harness\n");

const metrics = [
  { name: "skewness", fn: skewness, key: "skewness" },
  { name: "kurtosis", fn: kurtosis, key: "kurtosis" },
];

for (const col of sk.header) {
  const vals = sk.rows.map(r => parseFloat(r[col])).filter(v => !isNaN(v));
  for (const { name, fn, key } of metrics) {
    const actual = fn(vals);
    const want = expected.skew_kurt.columns[col][key];
    const diff = Math.abs(actual - want);
    const pass = diff <= TOL;
    if (!pass) failures++;
    console.log(
      `${pass ? "PASS" : "FAIL"}  ${col.padEnd(12)} ${name.padEnd(8)} ` +
      `actual=${actual.toFixed(12)}  expected=${want.toFixed(12)}  |diff|=${diff.toExponential(3)}`,
    );
  }
}

/* ── Fix #3 — broadened missing-value detection via getQuality ── */
const mv = parseCsv(
  join(__dirname, "reference", "datasets", "missing_variants.csv"),
);
const quality = getQuality(mv.rows, mv.header);
// per-column missing count from columnsWithIssues (issue === "missing")
const missingByCol = Object.fromEntries(mv.header.map(c => [c, 0]));
for (const issue of quality.columnsWithIssues) {
  if (issue.issue === "missing") missingByCol[issue.col] = issue.count;
}

console.log("\nFix #3 — missing-value counts (getQuality) vs reference harness\n");

for (const col of mv.header) {
  const actual = missingByCol[col];
  const want = expected.missing_variants.missing_counts[col];
  const pass = actual === want;            // integer equality
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${col.padEnd(6)} actual=${actual}  expected=${want}`);
}

/* ── Fix #3 (class balance) — missing target values counted via getClassBalance ──
   Wired through analyzeDataset(data, columns, target), exactly as Analyze.jsx calls it
   (getClassBalance is a private local fn in index.js). We treat "gamma" as the target. */
const TARGET = "gamma";
const analysis = analyzeDataset(mv.rows, mv.header, TARGET);
const cbActual = analysis.classBalance.missingCount;
const cbWant = expected.missing_variants.missing_counts[TARGET];

console.log("\nFix #3 — class-balance missing count (getClassBalance) vs reference harness\n");
{
  const pass = cbActual === cbWant;        // integer equality
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${TARGET} (as target)  actual=${cbActual}  expected=${cbWant}`);
}

/* ── Group B — role detection keys on non-missing values (roles_missing.csv) ── */
const rm = parseCsv(
  join(__dirname, "reference", "datasets", "roles_missing.csv"),
);
const rmRef = expected.roles_missing.columns;

// BEFORE snapshot (captured in STEP 1, before the roles.js fix) for the diff.
const BEFORE = {
  bin_col: { role: "categorical", distinct: 5 },
  cat_col: { role: "categorical", distinct: 7 },
  num_col: { role: "numeric",     distinct: 16 },
  id_col:  { role: "identifier",  distinct: 24 },
};

const rolesAfter = detectColumnRoles(rm.rows, rm.header, null);
// engine's non-missing distinct, computed the same way the fixed engine does it
const distinctAfter = col => new Set(
  rm.rows.map(r => r[col]).filter(v => !isMissing(v)).map(v => String(v).toLowerCase().trim())
).size;

console.log("\nGroup B — role detection on non-missing values vs reference harness\n");
console.log("  BEFORE→AFTER diff:");
for (const col of rm.header) {
  const b = BEFORE[col];
  const aRole = rolesAfter[col], aDist = distinctAfter(col);
  const roleChg = b.role === aRole ? "(unchanged)" : `→ ${aRole}`;
  const distChg = b.distinct === aDist ? "(unchanged)" : `→ ${aDist}`;
  console.log(`    ${col.padEnd(8)} role: ${b.role.padEnd(11)} ${roleChg.padEnd(15)}` +
              ` distinct: ${String(b.distinct).padEnd(2)} ${distChg}`);
}
console.log();

for (const col of rm.header) {
  const role = rolesAfter[col];
  const wantRole = rmRef[col].expected_role;
  const rolePass = role === wantRole;
  if (!rolePass) failures++;
  console.log(`${rolePass ? "PASS" : "FAIL"}  ${col.padEnd(8)} role      actual=${role.padEnd(12)} expected=${wantRole}`);

  const dist = distinctAfter(col);
  const wantDist = rmRef[col].true_distinct;
  const distPass = dist === wantDist;
  if (!distPass) failures++;
  console.log(`${distPass ? "PASS" : "FAIL"}  ${col.padEnd(8)} distinct  actual=${dist} expected=${wantDist}`);
}

/* ── Group B — categorical-frequency display excludes missing tokens (cat_col) ── */
console.log("\nGroup B — categorical frequency display excludes missing tokens (cat_col)\n");

// (i) getVisualizations: category buckets should be the 4 real categories only.
const viz = getVisualizations(rm.rows, rm.header, [], ["cat_col"]);
const catViz = viz.find(v => v.col === "cat_col" && v.type === "categorical");
const vizKeys = catViz ? catViz.data.map(d => String(d.value)) : [];
console.log(`  getVisualizations cat_col bucket keys: [${vizKeys.join(", ")}]`);

const vizCountPass = vizKeys.length === 4;
if (!vizCountPass) failures++;
console.log(`${vizCountPass ? "PASS" : "FAIL"}  cat_col viz bucket count  actual=${vizKeys.length} expected=4`);

const vizNoMissing = vizKeys.every(k => !isMissing(k));
if (!vizNoMissing) failures++;
console.log(`${vizNoMissing ? "PASS" : "FAIL"}  cat_col viz keys contain no missing token`);

// (ii) getClassBalance (via analyzeDataset, cat_col as target): 4 real classes + (missing)=3.
const cbAnalysis = analyzeDataset(rm.rows, rm.header, "cat_col");
const cbClasses = cbAnalysis.classBalance.classes;
const realClasses = cbClasses.filter(c => !c.missing);
const missingBucket = cbClasses.find(c => c.missing);
console.log(`  getClassBalance cat_col class keys: [${realClasses.map(c => c.value).join(", ")}]` +
            `${missingBucket ? ` + (missing)=${missingBucket.count}` : ""}`);

const realNoMissing = realClasses.every(c => !isMissing(c.value));
if (!realNoMissing) failures++;
console.log(`${realNoMissing ? "PASS" : "FAIL"}  cat_col class keys contain no missing token`);

const realCountPass = realClasses.length === 4;
if (!realCountPass) failures++;
console.log(`${realCountPass ? "PASS" : "FAIL"}  cat_col real class count   actual=${realClasses.length} expected=4`);

const missCount = missingBucket ? missingBucket.count : 0;
const missPass = missCount === 3;
if (!missPass) failures++;
console.log(`${missPass ? "PASS" : "FAIL"}  cat_col (missing) bucket   actual=${missCount} expected=3`);

/* ── Fix #4 — health.js renormalizes when duplicate check is skipped ── */
console.log("\nFix #4 — health.js quality-dimension weighting (duplicates skip)\n");

// Minimal inputs: no target (targetDim neutral, classBalance null), pristine
// quality except the duplicate fields, so qualityDim is isolated & predictable.
const baseMeta = {
  target: null, rows: 100, columns: 5,
  numericCols: ["a", "b"], categoricalCols: ["c"], identifierCols: [],
};
const baseRel = { multicollinearPairs: [], targetCorrelations: {}, leakageSuspects: [] };
const baseQuality = { missingPct: 0, columnsWithIssues: [] };

const sumWeights = comps => Object.values(comps).reduce((s, c) => s + c.weight, 0);

// Case 1 — duplicatesComputed = true, 10/100 rows duplicated.
const h1 = getHealthScore({
  meta: baseMeta, relationships: baseRel, classBalance: null, statistics: [],
  quality: { ...baseQuality, duplicatesComputed: true, duplicateRows: 10 },
});
const c1 = h1.qualityBreakdown.components;
// expected 4-weight formula: 100*.45 + 0*.25 + 100*.15 + 100*.15 = 75
const case1a = "duplicates" in c1;
const case1b = Math.abs(sumWeights(c1) - 1.0) < 1e-9;
const case1c = h1.breakdown.quality === 75 && Number.isFinite(h1.score);
for (const [ok, msg] of [
  [case1a, "computed: components INCLUDE duplicates term"],
  [case1b, `computed: 4 weights sum to 1.0 (${sumWeights(c1)})`],
  [case1c, `computed: qualityDim uses 4-weight formula (=${h1.breakdown.quality}, expected 75)`],
]) { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`); }

// Case 2 — duplicatesComputed = false, duplicateRows = null.
const h2 = getHealthScore({
  meta: baseMeta, relationships: baseRel, classBalance: null, statistics: [],
  quality: { ...baseQuality, duplicatesComputed: false, duplicateRows: null },
});
const c2 = h2.qualityBreakdown.components;
const case2a = Number.isFinite(h2.score) && Number.isFinite(h2.breakdown.quality); // no NaN
const case2b = Math.abs(sumWeights(c2) - 1.0) < 1e-9
  && Math.abs(c2.missing.weight - 0.60) < 1e-9
  && Math.abs(c2.constant.weight - 0.20) < 1e-9
  && Math.abs(c2.id.weight - 0.20) < 1e-9;                 // renormalized {0.60,0.20,0.20}
const case2c = !("duplicates" in c2);                       // duplicates dim absent
for (const [ok, msg] of [
  [case2a, `skipped: no NaN (score=${h2.score}, quality=${h2.breakdown.quality})`],
  [case2b, `skipped: 3 weights renormalized & sum to 1.0 (${sumWeights(c2)})`],
  [case2c, `skipped: duplicates dimension ABSENT from breakdown (keys: ${Object.keys(c2).join(",")})`],
]) { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`); }

/* ── Fix #5a — correlation ratio η vs reference harness ── */
const eta = parseCsv(
  join(__dirname, "reference", "datasets", "eta_numeric_cat.csv"),
);
const etaRef = expected.eta_numeric_cat.eta;

console.log("\nFix #5a — correlation ratio η (numeric feature vs categorical 'grp')\n");

for (const col of ["val", "noise"]) {
  // pair numeric value with grp label, excluding missing on both sides (same as engine)
  const values = [], labels = [];
  for (const r of eta.rows) {
    const rawV = r[col], rawL = r.grp;
    if (isMissing(rawV) || isMissing(rawL)) continue;
    const v = parseFloat(rawV);
    if (isNaN(v)) continue;
    values.push(v);
    labels.push(String(rawL).toLowerCase().trim());
  }
  const actual = etaCorrelation(values, labels);
  const want = etaRef[col];
  const diff = Math.abs(actual - want);
  const pass = diff <= TOL;
  if (!pass) failures++;
  console.log(
    `${pass ? "PASS" : "FAIL"}  ${col.padEnd(6)} η actual=${actual.toFixed(12)} ` +
    `expected=${want.toFixed(12)}  |diff|=${diff.toExponential(3)}`,
  );
}

/* ── Step 2a — identifier-numeric detection (the false-positive battleground) ──
   Role detection isn't a Python-computable metric, so intended roles live here as an
   INTENDED map (like expected_role in roles_missing), not in expected.json. */
const idn = parseCsv(
  join(__dirname, "reference", "datasets", "identifier_numeric.csv"),
);
const INTENDED = {
  // MUST be identifier (numeric-but-categorical codes)
  phone:             ROLE.IDENTIFIER,   // 10-digit, non-sequential, name+uniqueness
  zip_code:          ROLE.IDENTIFIER,   // 5-digit w/ repeats, name-hint + constant-width
  account_id:        ROLE.IDENTIFIER,   // high-unique integer, name-hinted
  leading_zero_code: ROLE.IDENTIFIER,   // 07030/00123 — R4 leading-zero, decisive alone
  // MUST stay numeric (the FP guards)
  age:               ROLE.NUMERIC,
  price:             ROLE.NUMERIC,      // decimals → not integer-form
  salary:            ROLE.NUMERIC,      // ← CRITICAL: width+uniqueness ALONE must not flag
  year:              ROLE.NUMERIC,      // 4-digit width < 5 floor
  temperature:       ROLE.NUMERIC,      // decimals
  count_kids:        ROLE.NUMERIC,      // 0–8 low-cardinality count
};
const idnRoles = detectColumnRoles(idn.rows, idn.header, null);

console.log("\nStep 2a — identifier-numeric detection (intended-role map)\n");
for (const col of idn.header) {
  const actual = idnRoles[col];
  const want   = INTENDED[col];
  const pass   = actual === want;
  if (!pass) failures++;
  const tag = want === ROLE.IDENTIFIER ? "[must=ID ]" : "[must=NUM]";
  console.log(`${pass ? "PASS" : "FAIL"}  ${tag} ${col.padEnd(18)} actual=${String(actual).padEnd(12)} expected=${want}`);
}

/* ── Step 2b — temporal detection (FP battleground) ──
   Intended roles as an INTENDED map (not expected.json — role detection isn't a
   Python-reproducible metric). ≥90% valid dates of one family → TEMPORAL. */
const tmp = parseCsv(
  join(__dirname, "reference", "datasets", "temporal.csv"),
);
const INTENDED_TMP = {
  // MUST be temporal
  iso_date:     ROLE.TEMPORAL,    // 2024-01-15
  iso_datetime: ROLE.TEMPORAL,    // 2024-01-15T10:30:00
  us_slash:     ROLE.TEMPORAL,    // 01/15/2024, day>12 present → US mdy, no conflict
  month_name:   ROLE.TEMPORAL,    // 15-Jan-2024
  // MUST NOT be temporal (the FP guards)
  year:         ROLE.NUMERIC,     // ← CRITICAL: bare 4-digit ints, no date structure
  phone:        ROLE.IDENTIFIER,  // ← 2a must not regress
  account_id:   ROLE.IDENTIFIER,  // ← 2a must not regress
  price:        ROLE.NUMERIC,     // decimals
  category:     ROLE.CATEGORICAL, // red/green/blue
  mixed_junk:   ROLE.CATEGORICAL, // ← 90% rule: one stray date must not flip the column
};
const tmpRoles = detectColumnRoles(tmp.rows, tmp.header, null);

console.log("\nStep 2b — temporal detection (intended-role map)\n");
for (const col of tmp.header) {
  const actual = tmpRoles[col];
  const want   = INTENDED_TMP[col];
  const pass   = actual === want;
  if (!pass) failures++;
  const tag =
    want === ROLE.TEMPORAL   ? "[must=TIME]" :
    want === ROLE.IDENTIFIER ? "[must=ID  ]" :
    want === ROLE.NUMERIC    ? "[must=NUM ]" : "[must=CAT ]";
  console.log(`${pass ? "PASS" : "FAIL"}  ${tag} ${col.padEnd(13)} actual=${String(actual).padEnd(12)} expected=${want}`);
}

/* ── Phase 2 Step 1 — insights.js:64 precedence bug ──
   A column with 30% missing (in the 5–50% band) MUST emit a "Missing Values in X"
   warning. Pre-fix, `c.count ?? parseInt(c.detail) / meta.rows` parsed as
   `c.count ?? (…/rows)` → pct = count*100 → gate 5<pct≤50 never true → insight suppressed. */
console.log("\nPhase 2 Step 1 — missing-values insight fires in the 5–50% band\n");

const missRows = Array.from({ length: 20 }, (_, i) => ({
  feat:  i < 6 ? "" : String((i % 4) * 10),   // 6/20 = 30% missing, low-cardinality numeric
  other: String(100 + i * 2),
  y:     i % 2 === 0 ? "1" : "0",
}));
const missAnalysis = analyzeDataset(missRows, ["feat", "other", "y"], "y");
const missInsight = missAnalysis.insights.find(ins => ins.title === 'Missing Values in "feat"');

const missBandPass = !!missInsight && missInsight.severity === "warning" && /30%/.test(missInsight.text);
if (!missBandPass) failures++;
console.log(
  `${missBandPass ? "PASS" : "FAIL"}  feat @ 30% missing → insight present ` +
  `(title="${missInsight?.title ?? "(none)"}", sev="${missInsight?.severity ?? "-"}")`,
);

/* ── Phase 2 Step 2 — composite predictor-ranking insight ──
   Numeric target with 3 features of known differing association: feat_strong (strong
   NEGATIVE → ↓), feat_mid (moderate positive), feat_noise (~independent). Assert the
   insight ranks strong before mid, noise absent-or-last, and shows the ↓ direction. */
console.log("\nPhase 2 Step 2 — top-predictors insight ranks features correctly\n");

const predRows = Array.from({ length: 40 }, (_, i) => ({
  y:           i,                          // numeric target 0..39
  feat_strong: 500 - 12 * i,               // strong NEGATIVE linear → ↓, ranks #1
  feat_mid:    i * 3 + (i % 5) * 30,        // moderate positive, noisier
  feat_noise:  (i * 37) % 11,              // ~independent of y
}));
const predAnalysis = analyzeDataset(predRows, ["y", "feat_strong", "feat_mid", "feat_noise"], "y");
const predInsight  = predAnalysis.insights.find(ins => ins.title === "Top Predictors of Target");

const pBody   = predInsight?.text ?? "";
const iStrong = pBody.indexOf("feat_strong");
const iMid    = pBody.indexOf("feat_mid");
const iNoise  = pBody.indexOf("feat_noise");

const checks = [
  ["insight present",               !!predInsight],
  ["feat_strong before feat_mid",   iStrong !== -1 && iMid !== -1 && iStrong < iMid],
  ["feat_noise absent or last",     iNoise === -1 || iNoise > iMid],
  ["pearson ↓ direction shown",     /↓/.test(pBody)],
];
for (const [msg, ok] of checks) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
}
console.log(`  body: ${pBody || "(none)"}`);

/* ── Phase 2 Step 3 — row-to-feature overfitting insight (3 bands) ── */
console.log("\nPhase 2 Step 3 — row/feature overfitting insight\n");

// varied low-cardinality numeric features (stay numeric: not identifier/constant/high-card)
const mkRatioRows = (nRows, nFeat) =>
  Array.from({ length: nRows }, (_, i) => {
    const row = {};
    for (let k = 0; k < nFeat; k++) row[`f${k}`] = String(((i * (k + 2) + k * 7) % 6) * 10 + (k + 1));
    return row;
  });
const mkCols = nFeat => Array.from({ length: nFeat }, (_, k) => `f${k}`);

const runRatio = (nRows, nFeat) => {
  const cols = mkCols(nFeat);
  const a = analyzeDataset(mkRatioRows(nRows, nFeat), cols, null);
  return {
    high: a.insights.some(i => i.title === "High Overfitting Risk"),
    mod:  a.insights.some(i => i.title === "Limited Rows per Feature"),
    body: (a.insights.find(i => i.title === "High Overfitting Risk" || i.title === "Limited Rows per Feature") || {}).text ?? "",
  };
};

const rHigh = runRatio(12, 4);   // ratio 3  → warning
const rMod  = runRatio(21, 3);   // ratio 7  → info
const rOk   = runRatio(40, 2);   // ratio 20 → neither

const ratioChecks = [
  ["HIGH: warning fires, body mentions ratio", rHigh.high && !rHigh.mod && /rows per feature/.test(rHigh.body)],
  ["MODERATE: info fires (not warning)",        rMod.mod && !rMod.high],
  ["HEALTHY: neither insight fires",            !rOk.high && !rOk.mod],
];
for (const [msg, ok] of ratioChecks) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
}
console.log(`  high body: ${rHigh.body}`);

/* ── Phase 2 Step 4 — temporal guidance insights (feature vs target) ── */
console.log("\nPhase 2 Step 4 — temporal guidance insights\n");

const pad2   = n => String(n).padStart(2, "0");
const isoDay = i => `2024-${pad2((i % 12) + 1)}-${pad2((i % 28) + 1)}`;   // valid varied ISO dates
const titles = a => a.insights.map(i => i.title);

// a. temporal FEATURE (date col is NOT the target)
const aRows = Array.from({ length: 40 }, (_, i) => ({ signup: isoDay(i), y: String(i) }));
const aOut  = analyzeDataset(aRows, ["signup", "y"], "y");
const aDate = aOut.insights.find(i => i.title === "Date Columns Detected");

// b. temporal TARGET (date col passed AS target)
const bRows = Array.from({ length: 40 }, (_, i) => ({ signup: isoDay(i), f1: String((i * 7) % 23 + 3) }));
const bOut  = analyzeDataset(bRows, ["signup", "f1"], "signup");

// c. NO temporal (plain numeric + categorical)
const cRows = Array.from({ length: 40 }, (_, i) => ({
  num1: String((i * 3) % 40 + 5), num2: String((i * 5) % 30 + 2), cat1: ["red", "green", "blue"][i % 3],
}));
const cOut  = analyzeDataset(cRows, ["num1", "num2", "cat1"], null);

const tempChecks = [
  ["FEATURE: 'Date Columns Detected' fires & names signup", !!aDate && /signup/.test(aDate.text)],
  ["FEATURE: no 'Temporal Target' insight",                 !titles(aOut).includes("Temporal Target (Forecasting)")],
  ["TARGET: 'Temporal Target (Forecasting)' fires",         titles(bOut).includes("Temporal Target (Forecasting)")],
  ["TARGET: 'Date Columns Detected' does NOT fire",         !titles(bOut).includes("Date Columns Detected")],
  ["NONE: neither temporal insight fires",                  !titles(cOut).includes("Date Columns Detected") && !titles(cOut).includes("Temporal Target (Forecasting)")],
];
for (const [msg, ok] of tempChecks) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
}

/* ── Phase 2 Step 5 — kurtosis heavy-tails insight ──
   Calibrated via helpers.kurtosis: heavyA≈17.3, heavyB≈9.6 (both >3), normal≈-1.2 (<3). */
console.log("\nPhase 2 Step 5 — heavy-tailed (kurtosis) insight\n");

const heavyA = i => String(i < 2 ? 300 : 10 + (i % 5));   // 2 big spikes → kurtosis ~17
const heavyB = i => String(i < 3 ? 80  : 10 + (i % 5));   // 3 milder spikes → kurtosis ~9.6
const normalC = i => String(10 + (i % 9));                // ~uniform, platykurtic → kurtosis <0
const mk = (spec) => Array.from({ length: 40 }, (_, i) => {
  const row = {}; for (const [k, fn] of Object.entries(spec)) row[k] = fn(i); return row;
});
const titlesOf = a => a.insights.map(i => i.title);

// a. heavy-tailed column + normal column
const kaOut  = analyzeDataset(mk({ hcol: heavyA, ncol: normalC }), ["hcol", "ncol"], null);
const kaIns  = kaOut.insights.find(i => i.title === "Heavy-Tailed Features");
// b. two heavy-tailed columns of differing kurtosis (distinctive names avoid substring collisions)
const kbOut  = analyzeDataset(mk({ spikebig: heavyA, spikemid: heavyB }), ["spikebig", "spikemid"], null);
const kbBody = (kbOut.insights.find(i => i.title === "Heavy-Tailed Features") || {}).text ?? "";
// c. only roughly-normal columns
const kcOut  = analyzeDataset(mk({ n1: normalC, n2: i => String(20 + (i % 7)) }), ["n1", "n2"], null);

const kChecks = [
  ["HEAVY: insight fires, names hcol not ncol", !!kaIns && /hcol/.test(kaIns.text) && !/ncol/.test(kaIns.text)],
  ["RANKING: higher-kurtosis 'spikebig' before 'spikemid'", kbBody.indexOf("spikebig") !== -1 && kbBody.indexOf("spikebig") < kbBody.indexOf("spikemid")],
  ["NORMAL: insight does NOT fire",             !titlesOf(kcOut).includes("Heavy-Tailed Features")],
];
for (const [msg, ok] of kChecks) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
}
console.log(`  heavy body: ${kaIns?.text ?? "(none)"}`);

/* ── Phase 2 Step 6 — minority-class count in imbalance insights ── */
console.log("\nPhase 2 Step 6 — minority-class absolute count\n");

// build an imbalanced target from [value, n] pairs
const mkImb = (counts) => {
  const rows = []; let i = 0;
  for (const [val, n] of counts) for (let k = 0; k < n; k++) { rows.push({ y: val, f: String((i * 7) % 50) }); i++; }
  return rows;
};
const imbBody = (counts) => {
  const a = analyzeDataset(mkImb(counts), ["y", "f"], "y");
  const ins = a.insights.find(i => i.title === "Severe Class Imbalance" || i.title === "Class Imbalance");
  return ins?.text ?? "";
};

const bodyFew   = imbBody([["1", 95],  ["0", 6]]);            // 94% majority → severe; minority 6
const bodyEnough= imbBody([["1", 500], ["0", 80]]);          // 86% majority → moderate; minority 80
const bodyMulti = imbBody([["A", 200], ["B", 150], ["C", 8]]); // multiclass; smallest = C(8)

const imbChecks = [
  ["FEW: count 6 + 'critically few'",        /6 sample/.test(bodyFew) && /critically few/.test(bodyFew)],
  ["ENOUGH: count 80, no alarm wording",     /80 sample/.test(bodyEnough) && !/critically few/.test(bodyEnough) && !/may be too few/.test(bodyEnough)],
  ["MULTICLASS: smallest 'C' has 8, critical",/smallest class "C" has 8 sample/.test(bodyMulti) && /critically few/.test(bodyMulti)],
];
for (const [msg, ok] of imbChecks) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
}
console.log(`  few body:    ${bodyFew}`);
console.log(`  enough body: ${bodyEnough}`);

console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"}`);
process.exit(failures === 0 ? 0 : 1);
