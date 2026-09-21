/* The plan applied to rows: every statistic LEARNED from the training rows only,
   then applied unchanged to any rows. A median, a scale or a category list taken
   from the whole file lets the held-out rows shape the features they are scored
   on, and the score it produces is optimistic by an amount nobody can see.

   Mirrors what the exported scikit-learn script does (sklearn.js), step for step:
   SimpleImputer → StandardScaler for numbers, SimpleImputer(most_frequent) →
   OneHotEncoder(max_categories = MAX_CATEGORIES, infrequent bucket) for
   categories, MissingIndicator for the flag and presence columns. */

import { isMissing, normalizeValue, toNumber } from "../../components/utils/core/helpers.js";

export const MAX_CATEGORIES = 20;
const INFREQUENT = "\u0000infrequent";

const numberOf = (v) => (isMissing(v) ? NaN : toNumber(v));
const levelOf  = (v) => (isMissing(v) ? null : normalizeValue(v));

/* Rows a model can use: the target recorded (it is never imputed), and — when
   the file has duplicate rows — only the first copy, or a row could sit in train
   and test at once. → array of row indices. */
export function usableRows(plan, rows) {
  const seen = plan.dropDuplicates ? new Set() : null;
  const keep = [];
  for (let i = 0; i < rows.length; i++) {
    if (isMissing(rows[i][plan.target])) continue;
    if (seen) {
      const key = JSON.stringify(Object.values(rows[i]));
      if (seen.has(key)) continue;
      seen.add(key);
    }
    keep.push(i);
  }
  return keep;
}

/* The target as numbers: a class index per row (classes sorted, so the order
   never depends on the file) or the numeric value. */
export function encodeTarget(plan, rows, idx) {
  if (plan.task === "regression") {
    return { y: Float64Array.from(idx, i => numberOf(rows[i][plan.target])), classes: null };
  }
  const keys = idx.map(i => levelOf(rows[i][plan.target]));
  const classes = [...new Set(keys)].sort();
  const index = new Map(classes.map((c, j) => [c, j]));
  return { y: Int32Array.from(keys, k => index.get(k)), classes };
}

function median(sorted) {
  const m = sorted.length >> 1;
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

function mostFrequent(counts) {
  let best = null, bestCount = -1;
  for (const [key, count] of counts) {
    // ties go to the smaller key, as SimpleImputer(most_frequent) breaks them
    if (count > bestCount || (count === bestCount && key < best)) { best = key; bestCount = count; }
  }
  return best;
}

/* → a fitted plan: [{ kind, col, … }], each part knowing its own output width.
   `features` narrows the plan to some columns (the one-column check in item 36). */
export function fitPrep(plan, rows, trainIdx, features = null) {
  const use = (col) => !features || features.includes(col);
  const parts = [];

  for (const { col, impute, flag } of plan.numeric.filter(f => use(f.col))) {
    const values = [];
    for (const i of trainIdx) { const x = numberOf(rows[i][col]); if (!Number.isNaN(x)) values.push(x); }
    if (values.length === 0) continue;             // nothing to learn from — SimpleImputer drops it too
    let fill;
    if (impute === "median") fill = median(values.slice().sort((a, b) => a - b));
    else if (impute === "mean") fill = values.reduce((s, x) => s + x, 0) / values.length;
    else fill = Number(mostFrequent(values.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map())));
    // StandardScaler sees the IMPUTED column: missing rows count as the fill.
    const missingCount = trainIdx.length - values.length;
    const mean = (values.reduce((s, x) => s + x, 0) + missingCount * fill) / trainIdx.length;
    const ss = values.reduce((s, x) => s + (x - mean) ** 2, 0) + missingCount * (fill - mean) ** 2;
    const scale = Math.sqrt(ss / trainIdx.length) || 1;   // a constant column scales by 1, as StandardScaler does
    parts.push({ kind: "numeric", col, fill, mean, scale, width: 1 });
    if (flag) parts.push({ kind: "missing", col, width: 1 });
  }

  for (const { col, flag } of plan.categorical.filter(f => use(f.col))) {
    const counts = new Map();
    for (const i of trainIdx) { const l = levelOf(rows[i][col]); if (l !== null) counts.set(l, (counts.get(l) ?? 0) + 1); }
    if (counts.size === 0) continue;
    const fill = mostFrequent(counts);
    counts.set(fill, counts.get(fill) + (trainIdx.length - [...counts.values()].reduce((s, c) => s + c, 0)));
    const ranked = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([l]) => l);
    const levels = ranked.length > MAX_CATEGORIES ? [...ranked.slice(0, MAX_CATEGORIES - 1), INFREQUENT] : ranked;
    parts.push({ kind: "categorical", col, fill, levels, index: new Map(levels.map((l, j) => [l, j])), width: levels.length });
    if (flag) parts.push({ kind: "missing", col, width: 1 });
  }

  for (const col of plan.presence.filter(use)) parts.push({ kind: "missing", col, width: 1 });

  return { parts, width: parts.reduce((s, p) => s + p.width, 0) };
}

/* → Float64Array, idx.length × width, row-major. Nothing is learned here. */
export function transformRows(fitted, rows, idx) {
  const { parts, width } = fitted;
  const X = new Float64Array(idx.length * width);
  idx.forEach((i, r) => {
    let c = r * width;
    for (const p of parts) {
      const v = rows[i][p.col];
      if (p.kind === "numeric") {
        const x = numberOf(v);
        X[c] = ((Number.isNaN(x) ? p.fill : x) - p.mean) / p.scale;
      } else if (p.kind === "missing") {
        X[c] = isMissing(v) ? 1 : 0;
      } else {
        const level = levelOf(v) ?? p.fill;
        const j = p.index.get(level) ?? p.index.get(INFREQUENT);   // unseen: the infrequent bucket, or all zeros
        if (j !== undefined) X[c + j] = 1;
      }
      c += p.width;
    }
  });
  return X;
}
