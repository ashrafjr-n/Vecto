/* Train vs test — a second file checked against the one the report was built on.
   Pure; runs in a worker (compareWorker.js). Rows are compared on the columns both
   files share, and every judgement is read from the train file's report (its roles,
   identifiers and plan), so the comparison and the report cannot disagree.

   The questions, in the order they can hurt a model:
     1. Leakage — test rows that are also in train, or the same entities on both sides.
     2. Schema — columns the model would need that the test file lacks, or that changed type.
     3. Shift — the target and each feature distributed differently (PSI, KS).
   → { rows, schema, overlap, entities, dates, target, features, items, verdict } */

import { ROLE } from "../components/utils/core/roles.constants.js";
import { isMissing, isNumeric, normalizeValue, toNumber } from "../components/utils/core/helpers.js";
import { rowKey } from "../components/utils/core/analyzers/duplicates.js";
import { parseDate, dayFirstFor } from "../components/utils/core/detectors/temporal.js";
import { buildPrepPlan } from "./prep/plan.js";

/* Population Stability Index bands — the credit-scoring convention: under 0.1 the
   distribution is stable, 0.1-0.25 it has moved, 0.25 and over it is a different one. */
export const PSI_MODERATE = 0.1;
export const PSI_MAJOR = 0.25;
const PSI_BINS = 10;
const TOP_LEVELS = 20;
const EPS = 1e-4;
/* Unseen categories on this share of test rows or more need handling before scoring. */
export const UNSEEN_SHARE = 0.05;
/* A column's missing share moving by this many points is a different collection. */
export const MISSING_SHIFT = 10;

const pct = (n, d) => (d > 0 ? n / d : 0);
const round = (x, d = 3) => (Number.isFinite(x) ? Number(x.toFixed(d)) : null);

/* PSI, corrected for sample size. Two samples from ONE distribution do not score 0:
   the expected PSI between them is about (bins − 1)(1/n + 1/m) — PSI is a symmetrised
   chi-square over n. Measured on the sample report split 400/100 at random, an
   untouched "age" scored 0.19, "moderate", against an expected 0.11 from chance alone.
   The bias is subtracted before any band is read; `raw` keeps the textbook figure. */
function psi(expected, actual, n = Infinity, m = Infinity) {
  let s = 0, bins = 0;
  for (let i = 0; i < expected.length; i++) {
    if (expected[i] === 0 && actual[i] === 0) continue;
    bins++;
    const e = Math.max(expected[i], EPS), a = Math.max(actual[i], EPS);
    s += (a - e) * Math.log(a / e);
  }
  const bias = Math.max(0, bins - 1) * (1 / n + 1 / m);
  return { value: Math.max(0, s - bias), raw: s };
}

/* Two-sample Kolmogorov-Smirnov: D and its asymptotic p-value (Numerical Recipes). */
export function ksTest(a, b) {
  const x = [...a].sort((p, q) => p - q), y = [...b].sort((p, q) => p - q);
  const n = x.length, m = y.length;
  if (!n || !m) return null;
  let i = 0, j = 0, d = 0;
  while (i < n && j < m) {
    const v = Math.min(x[i], y[j]);
    while (i < n && x[i] <= v) i++;
    while (j < m && y[j] <= v) j++;
    d = Math.max(d, Math.abs(i / n - j / m));
  }
  const ne = Math.sqrt((n * m) / (n + m));
  const lambda = (ne + 0.12 + 0.11 / ne) * d;
  let p = 0;
  for (let k = 1; k <= 100; k++) {
    const term = 2 * (k % 2 ? 1 : -1) * Math.exp(-2 * k * k * lambda * lambda);
    p += term;
    if (Math.abs(term) < 1e-10) break;
  }
  return { d, pValue: Math.min(1, Math.max(0, p)) };
}

function numericShift(trainVals, testVals) {
  const sorted = [...trainVals].sort((p, q) => p - q);
  const edges = [];
  for (let b = 1; b < PSI_BINS; b++) {
    const e = sorted[Math.floor((b / PSI_BINS) * (sorted.length - 1))];
    if (edges[edges.length - 1] !== e) edges.push(e);
  }
  const binOf = (v) => { let k = 0; while (k < edges.length && v > edges[k]) k++; return k; };
  const e = new Array(edges.length + 1).fill(0), a = new Array(edges.length + 1).fill(0);
  for (const v of trainVals) e[binOf(v)]++;
  for (const v of testVals) a[binOf(v)]++;
  const ks = ksTest(trainVals, testVals);
  const mean = (xs) => xs.reduce((s, v) => s + v, 0) / (xs.length || 1);
  const p = psi(e.map((c) => pct(c, trainVals.length)), a.map((c) => pct(c, testVals.length)), trainVals.length, testVals.length);
  return {
    psi: p.value, psiRaw: p.raw,
    ks: ks?.d ?? null, pValue: ks?.pValue ?? null,
    trainMean: mean(trainVals), testMean: mean(testVals),
  };
}

/* `spell` maps a normalized value back to how the file writes it, for display. */
function categoricalShift(trainVals, testVals, spell = (k) => k) {
  const count = (vals) => { const m = new Map(); for (const v of vals) m.set(v, (m.get(v) ?? 0) + 1); return m; };
  const tr = count(trainVals), te = count(testVals);
  const levels = [...tr.entries()].sort((p, q) => q[1] - p[1]).slice(0, TOP_LEVELS).map(([k]) => k);
  const kept = new Set(levels);
  const bucket = (m, total, seen) => {
    const out = levels.map((k) => pct(m.get(k) ?? 0, total));
    let other = 0, unseen = 0;
    for (const [k, c] of m) if (!kept.has(k)) (seen.has(k) ? (other += c) : (unseen += c));
    return [...out, pct(other, total), pct(unseen, total)];
  };
  const trainSeen = new Set(tr.keys());
  const e = bucket(tr, trainVals.length, trainSeen), a = bucket(te, testVals.length, trainSeen);
  const unseenLevels = [...te.keys()].filter((k) => !trainSeen.has(k));
  const p = psi(e, a, trainVals.length, testVals.length);
  return { psi: p.value, psiRaw: p.raw, unseenShare: a[a.length - 1], unseenLevels: unseenLevels.slice(0, 5).map(spell), unseenCount: unseenLevels.length };
}

const levelOf = (value) => (value >= PSI_MAJOR ? "major" : value >= PSI_MODERATE ? "moderate" : "stable");

export function compareDatasets(train, test, result) {
  const { meta } = result;
  const trainCols = new Set(train.columns), testCols = new Set(test.columns);
  const shared = train.columns.filter((c) => testCols.has(c));
  const plan = buildPrepPlan(result);
  const modelCols = plan.usable ? [...plan.numeric.map((f) => f.col), ...plan.categorical.map((f) => f.col), ...plan.presence] : [];
  const items = [];
  const add = (level, title, detail) => items.push({ level, title, detail });

  /* ── schema ── */
  const onlyTrain = train.columns.filter((c) => !testCols.has(c));
  const onlyTest = test.columns.filter((c) => !trainCols.has(c));
  const typeChanges = [];
  for (const col of shared) {
    if (meta.columnRoles[col] !== ROLE.NUMERIC) continue;
    let present = 0, numeric = 0;
    for (const r of test.rows) { const v = r[col]; if (isMissing(v)) continue; present++; if (isNumeric(v)) numeric++; }
    if (present && numeric / present < 0.8) typeChanges.push({ col, testNumericShare: round(numeric / present, 2) });
  }
  const missingForModel = modelCols.filter((c) => !testCols.has(c));
  if (missingForModel.length) {
    add("blocker", `The test file lacks ${missingForModel.length === 1 ? "a column" : `${missingForModel.length} columns`} the model uses`,
      `${missingForModel.slice(0, 5).map((c) => `"${c}"`).join(", ")}${missingForModel.length > 5 ? " and more" : ""} — a pipeline fitted on the training file cannot score these rows.`);
  }
  if (typeChanges.length) {
    add("blocker", `Numbers in train, text in test: ${typeChanges.map((t) => `"${t.col}"`).join(", ")}`,
      "These columns are numeric in the training file but mostly not numbers in the test file — a different format or unit. Clean them the same way in both.");
  }

  /* ── the same rows on both sides ── */
  const sharedNoTarget = shared.filter((c) => c !== meta.target);
  const trainKeys = new Set(train.rows.map((r) => rowKey(r, sharedNoTarget)));
  let overlapRows = 0;
  for (const r of test.rows) if (trainKeys.has(rowKey(r, sharedNoTarget))) overlapRows++;
  if (overlapRows > 0) {
    add("blocker", `${overlapRows.toLocaleString()} test row${overlapRows === 1 ? " is" : "s are"} also in the training file`,
      `Identical on every shared column (${(pct(overlapRows, test.rows.length) * 100).toFixed(1)}% of the test file). The model has seen their answers, so the test score overstates how it does on new rows. Remove them from one side.`);
  }

  /* ── the same entities on both sides ── */
  const entityCols = [...new Set([...(meta.identifierCols ?? []), ...(result.sameTargetValues ?? []).map((s) => s.column),
    ...(plan.usable && plan.groupBy ? [plan.groupBy] : [])])]
    // A date can be unique per row without naming a record; the date checks read it instead.
    .filter((c) => testCols.has(c) && meta.columnRoles[c] !== ROLE.TEMPORAL);
  const entities = [];
  for (const col of entityCols) {
    const trainVals = new Set();
    let trainRowsWith = 0;
    for (const r of train.rows) if (!isMissing(r[col])) { trainRowsWith++; trainVals.add(normalizeValue(r[col])); }
    let testRows = 0, inTrain = 0;
    for (const r of test.rows) { if (isMissing(r[col])) continue; testRows++; if (trainVals.has(normalizeValue(r[col]))) inTrain++; }
    if (!testRows) continue;
    const perRow = trainVals.size >= 0.95 * trainRowsWith;   // one value per row: a row id
    entities.push({ col, perRow, testRows, inTrain, share: round(pct(inTrain, testRows)) });
    if (inTrain === 0) continue;
    if (perRow) {
      add("blocker", `${inTrain.toLocaleString()} test row${inTrain === 1 ? " has" : "s have"} a "${col}" value already in train`,
        `"${col}" is one value per row in the training file, so a test row with a known value is most likely the same record. Remove it from one side.`);
    } else if (pct(inTrain, testRows) >= 0.05) {
      add("fix", `${(pct(inTrain, testRows) * 100).toFixed(0)}% of test rows share a "${col}" with train`,
        `The same ${col} values appear on both sides. If the model will be used on new ${col} values, the test score is optimistic — split so each value is on one side only.`);
    }
  }

  /* ── dates: is the test file later? ── */
  let dates = null;
  const dateCol = (result.time?.column && testCols.has(result.time.column)) ? result.time.column
    : (meta.temporalCols ?? []).find((c) => testCols.has(c));
  if (dateCol) {
    const { dayFirst } = dayFirstFor(train.rows.slice(0, 2000).map((r) => r[dateCol]));
    const range = (rows) => {
      let lo = Infinity, hi = -Infinity;
      for (const r of rows) { const t = parseDate(r[dateCol], dayFirst); if (t === null) continue; if (t < lo) lo = t; if (t > hi) hi = t; }
      return Number.isFinite(lo) ? { from: lo, to: hi } : null;
    };
    const tr = range(train.rows), te = range(test.rows);
    if (tr && te) {
      dates = { column: dateCol, train: tr, test: te, testAfterTrain: te.from >= tr.to, overlap: te.from <= tr.to && te.to >= tr.from };
      if (dates.overlap && result.time?.recommendTimeSplit) {
        add("fix", `The two files cover the same period of "${dateCol}"`,
          "The report found the data changes over time, so a test file from the same period as training is optimistic. If the model will predict later rows, test on rows from after the training period.");
      }
    }
  }

  /* ── the target ── */
  let target = null;
  if (meta.target && testCols.has(meta.target) && !meta.targetIsConstant && !meta.targetIsIdentifier) {
    const trVals = train.rows.map((r) => r[meta.target]).filter((v) => !isMissing(v));
    const teVals = test.rows.map((r) => r[meta.target]).filter((v) => !isMissing(v));
    if (teVals.length === 0) {
      target = { labelled: false };
    } else if (meta.columnRoles[meta.target] === ROLE.NUMERIC) {
      const s = numericShift(trVals.map(toNumber).filter(Number.isFinite), teVals.map(toNumber).filter(Number.isFinite));
      target = { labelled: true, kind: "numeric", ...s, level: levelOf(s.psi) };
    } else {
      const shares = (vals) => { const m = new Map(); for (const v of vals) { const k = normalizeValue(v); m.set(k, (m.get(k) ?? 0) + 1); } return m; };
      const tr = shares(trVals), te = shares(teVals);
      const classes = [...new Set([...tr.keys(), ...te.keys()])].map((k) => ({
        value: String([...trVals, ...teVals].find((v) => normalizeValue(v) === k)).trim(),
        train: round(pct(tr.get(k) ?? 0, trVals.length)), test: round(pct(te.get(k) ?? 0, teVals.length)),
      })).sort((p, q) => q.train - p.train);
      const s = categoricalShift(trVals.map(normalizeValue), teVals.map(normalizeValue));
      target = { labelled: true, kind: "classes", classes, psi: s.psi, level: levelOf(s.psi), newClasses: s.unseenCount };
    }
    if (target.labelled && target.level !== "stable") {
      add("fix", `"${meta.target}" is distributed differently in the test file`,
        `PSI ${target.psi.toFixed(2)} (${target.level}). A score on this test file measures a different mix than the one the model trained on${target.kind === "classes" ? " — compare the class shares below, and prefer a metric that is stable to the mix (balanced accuracy, PR-AUC)" : ""}.`);
    }
  }

  /* ── every feature the model uses ── */
  const features = [];
  for (const col of shared) {
    const role = meta.columnRoles[col];
    if (col === meta.target || ![ROLE.NUMERIC, ROLE.CATEGORICAL, ROLE.BINARY].includes(role)) continue;
    if (modelCols.length && !modelCols.includes(col)) continue;
    const trRaw = train.rows.map((r) => r[col]), teRaw = test.rows.map((r) => r[col]);
    const missTrain = pct(trRaw.filter(isMissing).length, trRaw.length), missTest = pct(teRaw.filter(isMissing).length, teRaw.length);
    const trVals = trRaw.filter((v) => !isMissing(v)), teVals = teRaw.filter((v) => !isMissing(v));
    if (!trVals.length || !teVals.length) continue;
    const entry = { col, kind: role === ROLE.NUMERIC ? "numeric" : "categorical", missingTrain: round(missTrain), missingTest: round(missTest) };
    if (entry.kind === "numeric") {
      Object.assign(entry, numericShift(trVals.map(toNumber).filter(Number.isFinite), teVals.map(toNumber).filter(Number.isFinite)));
    } else {
      const spelling = new Map();
      for (const v of teVals) { const k = normalizeValue(v); if (!spelling.has(k)) spelling.set(k, String(v).trim()); }
      Object.assign(entry, categoricalShift(trVals.map(normalizeValue), teVals.map(normalizeValue), (k) => spelling.get(k) ?? k));
    }
    entry.level = levelOf(entry.psi);
    entry.missingShift = Math.abs(missTest - missTrain) * 100 >= MISSING_SHIFT;
    features.push(entry);
  }
  features.sort((p, q) => q.psi - p.psi);
  const major = features.filter((f) => f.level === "major");
  if (major.length) {
    add("fix", `${major.length} feature${major.length === 1 ? " is" : "s are"} distributed very differently`,
      `${major.slice(0, 4).map((f) => `"${f.col}" (PSI ${f.psi.toFixed(2)})`).join(", ")}${major.length > 4 ? " and more" : ""}. A model leans on what it saw in training; where the test rows sit elsewhere, expect its score to drop.`);
  }
  const unseen = features.filter((f) => (f.unseenShare ?? 0) >= UNSEEN_SHARE);
  if (unseen.length) {
    add("fix", `Categories the training file never had`,
      `${unseen.map((f) => `"${f.col}" (${(f.unseenShare * 100).toFixed(0)}% of test rows, e.g. ${f.unseenLevels.slice(0, 2).map((v) => `"${v}"`).join(", ")})`).join("; ")}. The exported pipeline maps them to "infrequent"; check they are not a spelling or coding change.`);
  }
  const missShift = features.filter((f) => f.missingShift);
  if (missShift.length) {
    add("fix", "Missing values changed between the files",
      missShift.map((f) => `"${f.col}" ${(f.missingTrain * 100).toFixed(0)}% → ${(f.missingTest * 100).toFixed(0)}%`).join("; ") + ". A different collection process on one side — and a model that learned from which values were missing learned something the test file does not share.");
  }
  if (onlyTest.length && !missingForModel.length) {
    add("note", `The test file has ${onlyTest.length} column${onlyTest.length === 1 ? "" : "s"} the training file does not`,
      `${onlyTest.slice(0, 5).map((c) => `"${c}"`).join(", ")} — ignored by a pipeline fitted on the training file.`);
  }
  if (target && !target.labelled) {
    add("note", `The test file has no "${meta.target}" values`, "It can be scored but not evaluated — the shift checks above still apply.");
  }
  if (dates?.testAfterTrain) {
    add("note", "The test file is later than the training file", `By "${dates.column}" — the honest set-up for a model that will predict the future.`);
  }

  const order = { blocker: 0, fix: 1, note: 2 };
  items.sort((p, q) => order[p.level] - order[q.level]);
  const verdict = items.some((i) => i.level === "blocker") ? "blocked" : items.some((i) => i.level === "fix") ? "fix" : "ready";

  return {
    rows: { train: train.rows.length, test: test.rows.length },
    schema: { shared: shared.length, onlyTrain, onlyTest, typeChanges },
    overlap: { rows: overlapRows, share: round(pct(overlapRows, test.rows.length)) },
    entities, dates, target, features, items, verdict,
  };
}
