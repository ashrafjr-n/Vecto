/* The diagnostic baseline — ONE fixed, untuned model, cross-validated, used only
   as a measurement in the report. It answers two questions the correlations
   cannot answer together:
     1. Is there any signal? The columns taken jointly, against a model that
        knows nothing (the majority class, or the training mean).
     2. Is one column suspiciously good? Each column alone, through the same model.
   It is not a model to use: nothing is tuned, and the score is a floor, not an
   estimate of what a good model would reach.

   The model is ridge regression (alpha 1, scikit-learn's default), and for a class
   target the one-vs-rest ±1 form scikit-learn calls RidgeClassifier. Closed form,
   deterministic, no iterations to converge, and it runs on the item-35 preparation
   re-fitted inside every fold — so the score is what the exported script's
   features can support, with nothing learned from the rows it is scored on.

   Pure, outside the engine: it reads the finished report and the rows. */

import { isMissing, normalizeValue, sampleIndices } from "../../components/utils/core/helpers.js";
import { analyzeDataset, ANALYSIS_PHASES } from "../../components/utils/core/index.js";
import { buildPrepPlan } from "./plan.js";
import { assignFolds } from "./folds.js";
import { usableRows, encodeTarget, fitPrep, transformRows } from "./encode.js";

export const DIAG_FOLDS = 5;
export const RIDGE_ALPHA = 1;
/* The engine's leakage bar (|r| or V ≥ 0.95), on the model's own scale. */
export const SUSPICIOUS_SCORE = 0.95;
/* An estimator, not a count: a deterministic, evenly spread sample is enough to
   say whether a signal exists, and it keeps five folds × every column bounded. */
export const DIAG_ROWS = 5000;
const MIN_ROWS = 50;
/* Quantile bins for the one-column check. A class boundary that falls inside a bin
   leaves that bin mixed, so resolution caps the score: a U-shaped rule scored 0.925
   with 10 bins and 0.977 with 20 (tests/diagnostic.test.mjs). */
export const DIAG_BINS = 20;
/* Two-sided 5% critical value of Student's t with DIAG_FOLDS − 1 = 4 degrees of freedom. */
const T_CRITICAL = 2.776;

/* ── ridge ────────────────────────────────────────────────────────────────────
   Solves (XcᵀXc + αI) w = Xcᵀ(y − ȳ) with X centred, and the intercept
   ȳ − x̄·w, unpenalised — what scikit-learn's Ridge(fit_intercept=True) does.
   XᵀX is accumulated from each row's NON-ZERO entries only: a one-hot row has a
   handful of them among hundreds of columns, which is the difference between
   seconds and minutes. X: n × d row-major; Y: n × m row-major. */
export function ridgeFit(X, n, d, Y, m, alpha = RIDGE_ALPHA) {
  const A = new Float64Array(d * d), B = new Float64Array(d * m);
  const sx = new Float64Array(d), sy = new Float64Array(m);
  const nz = new Int32Array(d);
  for (let r = 0; r < n; r++) {
    let k = 0;
    const row = r * d;
    for (let a = 0; a < d; a++) if (X[row + a] !== 0) nz[k++] = a;
    for (let j = 0; j < m; j++) sy[j] += Y[r * m + j];
    for (let p = 0; p < k; p++) {
      const a = nz[p], xa = X[row + a];
      sx[a] += xa;
      for (let q = p; q < k; q++) A[a * d + nz[q]] += xa * X[row + nz[q]];
      for (let j = 0; j < m; j++) B[a * m + j] += xa * Y[r * m + j];
    }
  }
  for (let a = 0; a < d; a++) {
    for (let b = a; b < d; b++) {
      const v = A[a * d + b] - (sx[a] * sx[b]) / n + (a === b ? alpha : 0);
      A[a * d + b] = v; A[b * d + a] = v;
    }
    for (let j = 0; j < m; j++) B[a * m + j] -= (sx[a] * sy[j]) / n;
  }
  // Cholesky, in place in the lower triangle: A = LLᵀ (A is positive definite for α > 0).
  for (let j = 0; j < d; j++) {
    let s = A[j * d + j];
    for (let p = 0; p < j; p++) s -= A[j * d + p] ** 2;
    const l = Math.sqrt(Math.max(s, 1e-12));
    A[j * d + j] = l;
    for (let i = j + 1; i < d; i++) {
      let t = A[i * d + j];
      for (let p = 0; p < j; p++) t -= A[i * d + p] * A[j * d + p];
      A[i * d + j] = t / l;
    }
  }
  const W = new Float64Array(d * m), b = new Float64Array(m), z = new Float64Array(d);
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < d; i++) {                    // L z = B
      let t = B[i * m + j];
      for (let p = 0; p < i; p++) t -= A[i * d + p] * z[p];
      z[i] = t / A[i * d + i];
    }
    for (let i = d - 1; i >= 0; i--) {               // Lᵀ w = z
      let t = z[i];
      for (let p = i + 1; p < d; p++) t -= A[p * d + i] * W[p * m + j];
      W[i * m + j] = t / A[i * d + i];
    }
    let dot = 0;
    for (let a = 0; a < d; a++) dot += (sx[a] / n) * W[a * m + j];
    b[j] = sy[j] / n - dot;
  }
  return { W, b, d, m };
}

/* → Float64Array n × m of decision values. */
export function ridgePredict({ W, b, d, m }, X, n) {
  const out = new Float64Array(n * m);
  for (let r = 0; r < n; r++) {
    for (let j = 0; j < m; j++) {
      let s = b[j];
      for (let a = 0; a < d; a++) { const x = X[r * d + a]; if (x !== 0) s += x * W[a * m + j]; }
      out[r * m + j] = s;
    }
  }
  return out;
}

/* ── scores ─────────────────────────────────────────────────────────────────── */
/* Mean recall over the classes present in yTrue. A majority-class guess scores
   exactly 1 / (number of classes), whatever the imbalance — plain accuracy would
   call 95% "good" on a 95/5 target the model never learned. */
export function balancedAccuracy(yTrue, yPred) {
  const hit = new Map(), total = new Map();
  yTrue.forEach((t, i) => {
    total.set(t, (total.get(t) ?? 0) + 1);
    if (yPred[i] === t) hit.set(t, (hit.get(t) ?? 0) + 1);
  });
  let s = 0;
  for (const [t, n] of total) s += (hit.get(t) ?? 0) / n;
  return s / total.size;
}

export function r2(yTrue, yPred) {
  let mean = 0;
  for (const v of yTrue) mean += v;
  mean /= yTrue.length;
  let res = 0, tot = 0;
  yTrue.forEach((v, i) => { res += (v - yPred[i]) ** 2; tot += (v - mean) ** 2; });
  return tot === 0 ? 0 : 1 - res / tot;
}

const meanOf = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const sdOf = (xs) => {
  if (xs.length < 2) return 0;
  const m = meanOf(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};

/* ── one cross-validation ──────────────────────────────────────────────────── */
function crossValidate(plan, rows, idx, folds, y, classes, features, bins) {
  const classification = plan.task === "classification";
  const m = classification ? (classes.length === 2 ? 1 : classes.length) : 1;
  const model = [], baseline = [];

  for (let f = 0; f < DIAG_FOLDS; f++) {
    const trainPos = [], testPos = [];
    folds.forEach((fold, p) => (fold === f ? testPos : trainPos).push(p));
    if (trainPos.length === 0 || testPos.length === 0) continue;
    const trainRows = trainPos.map(p => idx[p]), testRows = testPos.map(p => idx[p]);
    const yTest = testPos.map(p => y[p]);

    const fitted = fitPrep(plan, rows, trainRows, features, { bins });
    if (fitted.width === 0) return null;
    const Xtr = transformRows(fitted, rows, trainRows);
    const Xte = transformRows(fitted, rows, testRows);

    if (classification) {
      const Y = new Float64Array(trainPos.length * m);
      trainPos.forEach((p, r) => {
        if (m === 1) Y[r] = y[p] === 1 ? 1 : -1;
        else for (let j = 0; j < m; j++) Y[r * m + j] = y[p] === j ? 1 : -1;
      });
      const scores = ridgePredict(ridgeFit(Xtr, trainPos.length, fitted.width, Y, m), Xte, testPos.length);
      const pred = testPos.map((_, r) => {
        if (m === 1) return scores[r] > 0 ? 1 : 0;
        let best = 0;
        for (let j = 1; j < m; j++) if (scores[r * m + j] > scores[r * m + best]) best = j;
        return best;
      });
      const counts = new Array(classes.length).fill(0);
      for (const p of trainPos) counts[y[p]]++;
      const majority = counts.indexOf(Math.max(...counts));   // bounded by the class count, not the rows
      model.push(balancedAccuracy(yTest, pred));
      baseline.push(balancedAccuracy(yTest, yTest.map(() => majority)));
    } else {
      const Y = Float64Array.from(trainPos, p => y[p]);
      const pred = ridgePredict(ridgeFit(Xtr, trainPos.length, fitted.width, Y, 1), Xte, testPos.length);
      const trainMean = meanOf(Y);
      model.push(r2(yTest, pred));
      baseline.push(r2(yTest, yTest.map(() => trainMean)));
    }
  }
  return model.length ? { model, baseline } : null;
}

/* ── the diagnostic ────────────────────────────────────────────────────────────
   → { status: "unavailable", reason } or
     { status: "ok", task, metric, rows, sampled, folds, split,
       model: { mean, sd }, baseline: { mean, sd }, lift, t, signal,
       nearPerfect, columns: [{ col, score }] (best first), suspicious: [col] } */
export function runDiagnostic(result, rows) {
  const plan = buildPrepPlan(result);
  if (!plan.usable) return { status: "unavailable", reason: plan.reason };

  let idx = usableRows(plan, rows);
  const sampled = idx.length > DIAG_ROWS;
  if (sampled) idx = sampleIndices(idx.length, DIAG_ROWS).map(p => idx[p]);
  if (idx.length < MIN_ROWS) {
    return { status: "unavailable", reason: `${idx.length} usable rows — too few to hold five folds out in turn.` };
  }

  const { y, classes } = encodeTarget(plan, rows, idx);
  if (classes && classes.length < 2) {
    return { status: "unavailable", reason: "Only one class is left once the unusable rows are removed." };
  }
  const folds = assignFolds(idx.length, DIAG_FOLDS, {
    groups: plan.groupBy ? (p) => (isMissing(rows[idx[p]][plan.groupBy]) ? null : normalizeValue(rows[idx[p]][plan.groupBy])) : null,
    strata: classes ? (p) => y[p] : null,
  });

  const full = crossValidate(plan, rows, idx, folds, y, classes, null, 0);
  if (!full) return { status: "unavailable", reason: "No column is left to train on once the plan's exclusions are applied." };

  /* Nadeau & Bengio (2003): folds share their training rows, so a plain paired t
     across folds overstates confidence. The corrected variance adds the test/train
     ratio (1 / (k − 1) for k folds) to the usual 1 / k. */
  const lifts = full.model.map((s, i) => s - full.baseline[i]);
  const lift = meanOf(lifts);
  const k = lifts.length;
  const variance = sdOf(lifts) ** 2 * (1 / k + 1 / (k - 1));
  const t = variance === 0 ? (lift > 0 ? Infinity : 0) : lift / Math.sqrt(variance);

  const features = [...plan.numeric.map(f => f.col), ...plan.categorical.map(f => f.col), ...plan.presence];
  const columns = features
    .map(col => ({ col, cv: crossValidate(plan, rows, idx, folds, y, classes, [col], DIAG_BINS) }))
    .filter(c => c.cv)
    .map(c => ({ col: c.col, score: meanOf(c.cv.model) }))
    .sort((a, b) => b.score - a.score);

  return {
    status: "ok",
    task: plan.task,
    metric: plan.task === "classification" ? "balanced_accuracy" : "r2",
    rows: idx.length,
    sampled,
    folds: k,
    split: plan.groupBy ? `grouped by "${plan.groupBy}"` : plan.task === "classification" ? "stratified" : "random",
    model: { mean: meanOf(full.model), sd: sdOf(full.model) },
    baseline: { mean: meanOf(full.baseline), sd: sdOf(full.baseline) },
    lift,
    t,
    signal: lift > 0 && t >= T_CRITICAL,
    nearPerfect: meanOf(full.model) >= SUSPICIOUS_SCORE,
    columns,
    suspicious: columns.filter(c => c.score >= SUSPICIOUS_SCORE).map(c => c.col),
  };
}

/* The report and its diagnostic, from one call — the worker and the synchronous
   fallback both use this, so the two paths cannot differ. The diagnostic is a
   measurement ON the report; if it fails, the report still renders and says so. */
export function withDiagnostic(result, rows) {
  if (!result) return result;
  let diagnostic;
  try {
    diagnostic = runDiagnostic(result, rows);
  } catch (err) {
    diagnostic = { status: "unavailable", reason: `The diagnostic model failed: ${err?.message ?? err}` };
  }
  return { ...result, diagnostic };
}

/* The engine's run, then the diagnostic as one more announced phase, so the
   processing screen counts "step 7 of 7" instead of stalling on step 6 while the
   folds run. The engine itself still announces six and knows nothing of this. */
export const DIAGNOSTIC_PHASE = { id: "diagnostic", label: "Cross-validating a baseline model" };
export function analyzeWithDiagnostic(data, columns, target, onPhase = () => {}, roleOverrides) {
  const total = ANALYSIS_PHASES.length + 1;
  const result = analyzeDataset(data, columns, target, (phase) => onPhase({ ...phase, total }), roleOverrides);
  onPhase({ ...DIAGNOSTIC_PHASE, index: total - 1, total });
  return withDiagnostic(result, data);
}
