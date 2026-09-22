/* vecto-plan item 36 — the diagnostic baseline. Locks the solver against
   scikit-learn, and the two verdicts against data whose answer is known by
   construction: no signal, clear signal, and a leak the correlations cannot see. */

import {
  ridgeFit, ridgePredict, balancedAccuracy, r2, runDiagnostic, withDiagnostic, SUSPICIOUS_SCORE,
} from "../src/lib/prep/diagnostic.js";
import { analyzeDataset } from "../src/components/utils/core/index.js";

let failed = 0;
const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failed++;
};
const close = (a, b) => Math.abs(a - b) < 1e-9;

/* ── the solver, against scikit-learn 1.7 ─────────────────────────────────────
   Reference values from:
     X = [[1,0,2.5],[0,1,-1],[1,1,0],[0,0,3],[1,0,-2],[0,1,0.5],[1,1,1.5],[0,0,-0.5]]
     Ridge(alpha=1.0).fit(X, [3.1,-0.4,1.2,4.0,-1.5,0.9,2.2,0.3])  → coef_, intercept_
     RidgeClassifier(alpha=1.0).fit(X, [0,1,2,0,1,2,0,2]).decision_function(X[:3]) */
const X = Float64Array.from([1,0,2.5, 0,1,-1, 1,1,0, 0,0,3, 1,0,-2, 0,1,0.5, 1,1,1.5, 0,0,-0.5]);
const fit = ridgeFit(X, 8, 3, Float64Array.from([3.1,-0.4,1.2,4.0,-1.5,0.9,2.2,0.3]), 1);
check("ridge coefficients and intercept match scikit-learn's Ridge",
  [0.033333333333, -0.002307692308, 0.993076923077].every((c, i) => Math.abs(fit.W[i] - c) < 1e-11)
  && Math.abs(fit.b[0] - 0.712948717949) < 1e-11);
const labels = [0, 1, 2, 0, 1, 2, 0, 2];
const Y = new Float64Array(24);
labels.forEach((k, r) => { for (let j = 0; j < 3; j++) Y[r * 3 + j] = k === j ? 1 : -1; });
const decision = ridgePredict(ridgeFit(X, 8, 3, Y, 3), X, 3);
check("one-vs-rest ±1 decision values match scikit-learn's RidgeClassifier",
  [0.985897435897, -1.176923076923, -0.808974358974, -1.239743589744, -0.007692307692,
   0.247435897436, -0.414102564103, -0.376923076923, -0.208974358974].every((v, i) => Math.abs(decision[i] - v) < 1e-11));

/* ── scores ─────────────────────────────────────────────────────────────────── */
check("a majority-class guess scores 1 / classes in balanced accuracy, whatever the imbalance",
  close(balancedAccuracy([0, 0, 0, 0, 0, 0, 0, 0, 0, 1], new Array(10).fill(0)), 0.5)
  && close(balancedAccuracy([0, 1, 2, 2], [0, 0, 0, 0]), 1 / 3));
check("R² is 1 for a perfect prediction and 0 for the mean", r2([1, 2, 3], [1, 2, 3]) === 1 && close(r2([1, 2, 3], [2, 2, 2]), 0));

/* ── verdicts on data whose answer is known ─────────────────────────────────── */
let seed = 17;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const n = 600;
const base = Array.from({ length: n }, () => ({ a: (rand() * 10).toFixed(3), b: (rand() * 10).toFixed(3), c: ["p", "q", "r"][Math.floor(rand() * 3)] }));
const run = (rows, target) => runDiagnostic(analyzeDataset(rows, Object.keys(rows[0]), target), rows);

const noise = base.map(r => ({ ...r, y: rand() < 0.5 ? "yes" : "no" }));
const dNoise = run(noise, "y");
check("a target unrelated to every column shows no signal", dNoise.status === "ok" && dNoise.signal === false);

const signal = base.map(r => ({ ...r, y: Number(r.a) + (rand() - 0.5) * 4 > 5 ? "yes" : "no" }));
const dSignal = run(signal, "y");
check("a target driven by one column shows signal, and names that column first",
  dSignal.signal === true && dSignal.columns[0].col === "a" && dSignal.model.mean > dSignal.baseline.mean);

/* |x − 5| decides the class: a U-shape. Pearson and Spearman are ~0, so the
   engine's leakage flags cannot see it — the binned one-column check must. */
const ushape = base.map(r => ({ ...r, y: Math.abs(Number(r.a) - 5) > 2.5 ? "far" : "near" }));
const uReport = analyzeDataset(ushape, Object.keys(ushape[0]), "y");
const dU = runDiagnostic(uReport, ushape);
check("the U-shaped column is not an engine leakage suspect (the case this check exists for)",
  !uReport.relationships.leakageSuspects.some(l => l.col === "a"));
check(`the one-column check flags it (score ≥ ${SUSPICIOUS_SCORE})`, dU.suspicious.includes("a") && !dU.suspicious.includes("b"));

const regression = base.map(r => ({ ...r, y: String(3 * Number(r.a) - Number(r.b) + rand()) }));
const dReg = run(regression, "y");
check("a regression target is scored in R², against the training mean", dReg.metric === "r2" && dReg.signal && dReg.baseline.mean < 0.05);
check("a well-behaved regression target is not called unstable", dReg.unstable === false);

/* Ask a Manager salaries: one 870,000,000 salary in a training fold moves its mean so far
   that "predict the average" scored R² −11 and the model −164. Those numbers describe the
   outlier, not the columns — the verdict is "cannot tell", not "no signal". */
const extreme = regression.map((r, i) => (i === 7 ? { ...r, y: "1e9" } : r));
const dExt = run(extreme, "y");
check("one extreme target value makes R² unstable: no signal verdict, no too-good flags",
  dExt.status === "ok" && dExt.unstable === true && dExt.signal === null && dExt.suspicious.length === 0
  && !dExt.nearPerfect && dExt.worstBaseline < -1);

check("the same file gives the same diagnostic twice",
  JSON.stringify(run(signal, "y")) === JSON.stringify(dSignal));
check("a constant target is unavailable, with the plan's reason",
  run(base.map(r => ({ ...r, y: "same" })), "y").status === "unavailable");
check("too few rows is unavailable, not a number",
  run(signal.slice(0, 30), "y").status === "unavailable");

/* ── it can never take the report down ─────────────────────────────────────── */
const report = analyzeDataset(signal, Object.keys(signal[0]), "y");
const broken = withDiagnostic(report, null);
check("a failing diagnostic is reported as unavailable and the report survives intact",
  broken.diagnostic.status === "unavailable" && /failed/.test(broken.diagnostic.reason) && broken.healthScore === report.healthScore);
check("no report, no diagnostic", withDiagnostic(null, signal) === null);

console.log(failed === 0 ? "all diagnostic checks passed" : `${failed} diagnostic check(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
