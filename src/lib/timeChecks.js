/* Time checks — what a date column says about how this file should be split and
   whether it can be trusted as one population. Pure, outside the engine like the
   diagnostic: it reads the finished report and the rows, and runs in the analysis
   worker (analyzeWithDiagnostic).

   A random split assumes the rows are exchangeable. When the target moves over the
   collection period, or a column only exists from some date on, that assumption is
   false and a random split scores the model on a mix of the past it trained on — the
   honest test is to train on earlier rows and test on later ones.

   → null when there is no date column, or
     { column, others, dayFirstAssumed, parsed, unparsed, from, to,
       periods: [{ from, to, rows, value }],   value = the target's rate or mean
       target: { kind: "rate" | "mean", label, pValue, spread, drifts } | null,
       futureRows, lateColumns: [{ col, startsAt, earlyMissingPct, lateMissingPct }],
       cutoff, recommendTimeSplit } */

import { ROLE } from "../components/utils/core/roles.constants.js";
import { isMissing, normalizeValue, toNumber, cramersV, rankEta } from "../components/utils/core/helpers.js";
import { parseDate, dayFirstFor } from "../components/utils/core/detectors/temporal.js";

export const PERIODS = 5;
/* A target moves over time when the periods differ beyond chance (p below this) AND by
   enough to matter: a rate that changes by 10 points, or a mean that changes by a
   fifth of the target's spread. Large files make tiny changes significant, so the
   size bar is the one that decides. */
export const DRIFT_P = 0.001;
export const DRIFT_RATE = 0.10;
export const DRIFT_SD = 0.2;
/* A column "starts late" when it is essentially empty in the earliest fifth of the
   period and mostly present in the latest fifth. */
const LATE_EARLY_MISSING = 90;
const LATE_LATE_MISSING = 50;
const MIN_ROWS = 50;

const quantileAt = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];
const pctOf = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

export function runTimeChecks(result, rows, now = Date.now()) {
  const { meta } = result;
  const dateCols = meta.temporalCols ?? [];
  if (!dateCols.length || !rows?.length) return null;

  /* The date column with the most parseable values; the others are named. */
  let best = null;
  for (const col of dateCols) {
    const values = rows.map(r => r[col]);
    const { dayFirst, assumed } = dayFirstFor(values.slice(0, 2000));
    let parsed = 0;
    const times = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
      const t = isMissing(values[i]) ? null : parseDate(values[i], dayFirst);
      times[i] = t;
      if (t !== null) parsed++;
    }
    if (!best || parsed > best.parsed) best = { col, times, parsed, assumed, dayFirst };
  }
  if (!best || best.parsed < MIN_ROWS) return null;

  const order = [];
  for (let i = 0; i < rows.length; i++) if (best.times[i] !== null) order.push(i);
  order.sort((a, b) => best.times[a] - best.times[b]);
  const sortedTimes = order.map(i => best.times[i]);
  const from = sortedTimes[0], to = sortedTimes[sortedTimes.length - 1];

  /* Equal-count periods in time order — every period has enough rows to be read. */
  const periodOf = new Map();
  const periods = [];
  for (let p = 0; p < PERIODS; p++) {
    const lo = Math.floor((p * order.length) / PERIODS), hi = Math.floor(((p + 1) * order.length) / PERIODS);
    if (hi <= lo) continue;
    for (let k = lo; k < hi; k++) periodOf.set(order[k], periods.length);
    periods.push({ from: sortedTimes[lo], to: sortedTimes[hi - 1], rows: hi - lo, value: null });
  }

  /* ── the target over time ── */
  let target = null;
  const tRole = meta.columnRoles[meta.target];
  if (meta.target && !meta.targetIsConstant && !meta.targetIsIdentifier && periods.length >= 2) {
    const idx = order.filter(i => !isMissing(rows[i][meta.target]));
    if (tRole === ROLE.BINARY || tRole === ROLE.CATEGORICAL) {
      /* The rate of the rarest class — the one a model is usually built to find. */
      const counts = new Map();
      for (const i of idx) { const k = normalizeValue(rows[i][meta.target]); counts.set(k, (counts.get(k) ?? 0) + 1); }
      const [rare] = [...counts.entries()].sort((a, b) => a[1] - b[1])[0] ?? [];
      const label = idx.map(i => rows[i][meta.target]).find(v => normalizeValue(v) === rare);
      const hits = new Array(periods.length).fill(0), totals = new Array(periods.length).fill(0);
      for (const i of idx) { const p = periodOf.get(i); totals[p]++; if (normalizeValue(rows[i][meta.target]) === rare) hits[p]++; }
      periods.forEach((per, p) => { per.value = totals[p] ? hits[p] / totals[p] : null; });
      const test = cramersV(idx.map(i => String(periodOf.get(i))), idx.map(i => normalizeValue(rows[i][meta.target])));
      const rates = periods.map(p => p.value).filter(v => v !== null);
      const spread = Math.max(...rates) - Math.min(...rates);
      target = { kind: "rate", label: String(label).trim(), pValue: test?.pValue ?? null, spread,
                 drifts: (test?.pValue ?? 1) < DRIFT_P && spread >= DRIFT_RATE };
    } else if (tRole === ROLE.NUMERIC) {
      const pairs = idx.map(i => [toNumber(rows[i][meta.target]), periodOf.get(i)]).filter(([v]) => Number.isFinite(v));
      const sums = new Array(periods.length).fill(0), totals = new Array(periods.length).fill(0);
      for (const [v, p] of pairs) { sums[p] += v; totals[p]++; }
      periods.forEach((per, p) => { per.value = totals[p] ? sums[p] / totals[p] : null; });
      const values = pairs.map(([v]) => v);
      const mean = values.reduce((s, v) => s + v, 0) / (values.length || 1);
      const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, values.length - 1));
      const means = periods.map(p => p.value).filter(v => v !== null);
      const spread = sd > 0 ? (Math.max(...means) - Math.min(...means)) / sd : 0;
      const test = rankEta(values, pairs.map(([, p]) => String(p)));
      target = { kind: "mean", label: meta.target, pValue: test?.pValue ?? null, spread,
                 drifts: (test?.pValue ?? 1) < DRIFT_P && spread >= DRIFT_SD };
    }
  }

  /* ── dates in the future, measured against when the report was made ── */
  const futureRows = sortedTimes.filter(t => t > now + 86_400_000).length;

  /* ── columns that exist only from some date on ── */
  const edge = Math.max(1, Math.floor(order.length / PERIODS));
  const early = order.slice(0, edge), late = order.slice(order.length - edge);
  const lateColumns = [];
  for (const col of Object.keys(meta.columnRoles)) {
    if (col === best.col || col === meta.target) continue;
    const missingIn = (set) => pctOf(set.filter(i => isMissing(rows[i][col])).length, set.length);
    const earlyMissingPct = missingIn(early), lateMissingPct = missingIn(late);
    if (earlyMissingPct >= LATE_EARLY_MISSING && lateMissingPct <= LATE_LATE_MISSING) {
      const first = order.find(i => !isMissing(rows[i][col]));
      lateColumns.push({ col, startsAt: first === undefined ? null : best.times[first], earlyMissingPct, lateMissingPct });
    }
  }

  /* Train on the first 80% of the period, test on the rest. */
  const cutoff = quantileAt(sortedTimes, 0.8);

  return {
    column: best.col,
    others: dateCols.filter(c => c !== best.col),
    dayFirstAssumed: best.assumed,
    dayFirst: best.dayFirst,
    parsed: best.parsed,
    unparsed: rows.length - best.parsed,
    from, to,
    periods,
    target,
    futureRows,
    lateColumns,
    cutoff,
    recommendTimeSplit: Boolean(target?.drifts) || lateColumns.length > 0,
  };
}
