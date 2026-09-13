/* Semantic leakage review (AI phase C) — the pure halves around the model call.

   buildLeakagePayload() sends NO values: column names, roles, the engine's own
   measured association with the target, its leakage flags, a numeric column's
   mean, and — only if the user already asked for a dossier — each column's
   meaning. The model judges what the engine cannot: whether a column is known
   before the outcome.

   verifyLeakage() turns every checkable claim into a measurement:
     derived_from_target  the proposed formula is EVALUATED on every row
     group_leak           groups and how often a group shares one target value
     restates_label       the engine's own association for that column
     recorded_after_outcome   cannot be measured — shown as a question
   Nothing here changes leakageSuspects, the health score or the advice. */

import { isMissing, normalizeValue, toNumber, rankEta } from "../../components/utils/core/helpers.js";
import { ROLE } from "../../components/utils/core/roles.constants.js";
import { LEAK_CATEGORIES, FORMULA_OPS, SPLIT_STRATEGIES, LEAKAGE_MAX_COLUMNS } from "./leakageSchema.js";

const sig = (x) => Number(x.toPrecision(4));
const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/* Drop undefined keys so the payload (and its preview) only says what is known. */
const compact = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

export function buildLeakagePayload(result, dossier) {
  const { meta, relationships, statistics } = result;
  const meaning = new Map((dossier?.columns ?? []).map((c) => [c.name, c]));
  const presence = new Map((relationships.presenceSignals ?? []).map((p) => [p.col, p.cramersV]));
  const flagged = new Map((relationships.leakageSuspects ?? []).map((l) => [l.col, l.metric]));
  const unscored = new Set((relationships.unscoredColumns ?? []).map((u) => u.col));
  const means = new Map((statistics ?? []).filter((s) => Number.isFinite(s.mean)).map((s) => [s.col, s.mean]));

  const describe = (name) => {
    const d = meaning.get(name);
    const tc = relationships.targetCorrelations?.[name];
    return compact({
      name,
      role: meta.columnRoles[name],
      meaning: d?.meaning || undefined,
      subtype: d?.subtype ?? undefined,
      unit: d?.unit ?? undefined,
      mean: means.has(name) ? sig(means.get(name)) : undefined,
      association: tc ? { metric: tc.metric, value: tc.value, n: tc.n } : undefined,
      presenceV: presence.get(name),
      engineLeakFlag: flagged.get(name),
      measured: name !== meta.target && unscored.has(name) ? false : undefined,
    });
  };

  return {
    schemaVersion: 1,
    rows: meta.rows,
    taskType: meta.datasetType,
    rowGrain: dossier?.rowGrain || undefined,
    target: describe(meta.target),
    columns: Object.keys(meta.columnRoles)
      .filter((c) => c !== meta.target)
      .slice(0, LEAKAGE_MAX_COLUMNS)
      .map(describe),
  };
}


/* ── Measurements ─────────────────────────────────────────────────────────── */

/* A row matches when |result − formula| is within 1% of the result or 0.01 in
   absolute terms — enough for values rounded to cents, not enough for a
   coincidence. Rows with any missing or non-numeric term are skipped and not
   counted, so `n` is the rows the formula could actually be checked on. */
const MATCH_REL = 0.01;
const MATCH_ABS = 0.01;

/* A formula can be right up to a FIXED amount the file does not record. Measured on
   seaborn's taxis: total = fare + tip + tolls holds exactly on 0.7% of 6,433 rows,
   because every total also carries a surcharge — the difference is +3.30 on 41% of
   rows, +3.80 on 23%, +4.30 on 13%, +0.80 on 10%. A wrong formula scatters its
   differences over many values instead. So the differences are counted, rounded to
   cents, and the most common few are reported with the share of rows they cover.
   ponytail: cents rounding assumes currency-like scale; tiny-scale data just lands
   in the exact-match share instead. The distinct-difference count is capped. */
const OFFSET_TOP = 5;
const OFFSET_KEYS_CAP = 1000;

export function evaluateFormula(data, { result, op, terms }) {
  let n = 0;
  let matched = 0;
  const offsets = new Map();
  const xs = new Array(terms.length);
  for (let i = 0; i < data.length; i++) {
    const y = toNumber(data[i][result]);
    if (Number.isNaN(y)) continue;
    let ok = true;
    for (let t = 0; t < terms.length; t++) {
      xs[t] = toNumber(data[i][terms[t]]);
      if (Number.isNaN(xs[t])) { ok = false; break; }
    }
    if (!ok) continue;
    let rhs = xs[0];
    for (let t = 1; t < xs.length; t++) {
      if (op === "sum") rhs += xs[t];
      else if (op === "difference") rhs -= xs[t];
      else if (op === "product") rhs *= xs[t];
      else rhs /= xs[t];
    }
    if (!Number.isFinite(rhs)) continue;
    n++;
    if (Math.abs(y - rhs) <= Math.max(MATCH_ABS, MATCH_REL * Math.abs(y))) matched++;
    const key = (y - rhs).toFixed(2);
    if (offsets.has(key)) offsets.set(key, offsets.get(key) + 1);
    else if (offsets.size < OFFSET_KEYS_CAP) offsets.set(key, 1);
  }
  const top = [...offsets].sort((a, b) => b[1] - a[1]).slice(0, OFFSET_TOP)
    .map(([offset, count]) => ({ offset: Number(offset), share: count / n }));
  return {
    n,
    matchShare: n ? matched / n : null,
    fixedOffsets: top,
    fixedOffsetShare: top.reduce((sum, o) => sum + o.share, 0),
  };
}

/* How an entity column would leak through a random split: how many rows share a
   group with another row, and how much of the target that group already decides.
   For a class target, `purity` is the share of those rows whose target equals
   their group's most common value, beside `baseline` — the most common class
   overall — because purity can never be below the baseline by construction. For a
   numeric target, rank η over the repeated groups. */
export function measureGroupLeak(data, groupCol, target, targetRole) {
  const groups = new Map();
  let n = 0;
  for (let i = 0; i < data.length; i++) {
    const g = data[i][groupCol];
    const t = data[i][target];
    if (isMissing(g) || isMissing(t)) continue;
    n++;
    const key = normalizeValue(g);
    let entry = groups.get(key);
    if (!entry) groups.set(key, (entry = { count: 0, rows: [] }));
    entry.count++;
    entry.rows.push(i);
  }

  let repeatedRows = 0;
  for (const e of groups.values()) if (e.count > 1) repeatedRows += e.count;
  const out = { n, groups: groups.size, repeatedRowShare: n ? repeatedRows / n : 0, purity: null, baseline: null, eta: null };
  if (repeatedRows === 0) return out;

  if (targetRole === ROLE.NUMERIC) {
    const values = [];
    const labels = [];
    for (const [key, e] of groups) {
      if (e.count < 2) continue;
      for (const i of e.rows) { values.push(toNumber(data[i][target])); labels.push(key); }
    }
    const kept = values.map((v, i) => [v, labels[i]]).filter(([v]) => !Number.isNaN(v));
    const res = rankEta(kept.map(([v]) => v), kept.map(([, l]) => l));
    out.eta = res ? res.value : null;
    return out;
  }

  const overall = new Map();
  let pure = 0;
  for (const e of groups.values()) {
    const counts = new Map();
    for (const i of e.rows) {
      const t = normalizeValue(data[i][target]);
      counts.set(t, (counts.get(t) ?? 0) + 1);
      overall.set(t, (overall.get(t) ?? 0) + 1);
    }
    if (e.count > 1) pure += Math.max(...counts.values());   // at most one entry per distinct target value
  }
  out.purity = pure / repeatedRows;
  out.baseline = Math.max(...overall.values()) / n;
  return out;
}


/* ── Verification ─────────────────────────────────────────────────────────── */

const RESTATES_CONFIRMED = 0.95;   // the engine's own leakage threshold (relations.js LEAKAGE_MIN)
const RESTATES_WEAK = 0.3;

/* → { findings, split, withheld, engineOnly } or { error }.
   verdict: "confirmed" | "partial" | "contradicted" | "unchecked" | "question". */
export function verifyLeakage(answer, { data, result }) {
  if (!answer || !Array.isArray(answer.findings)) {
    return { error: "The model's answer did not have the expected shape." };
  }
  const { meta, relationships } = result;
  const target = meta.target;
  const roles = meta.columnRoles;
  const known = new Set(Object.keys(roles));
  const withheld = [];
  const findings = [];
  const seen = new Set();

  for (const f of answer.findings) {
    const column = f?.column;
    if (typeof column !== "string" || !known.has(column)) {
      withheld.push({ column: String(column), reason: "not a column in this file" });
      continue;
    }
    if (column === target) {
      withheld.push({ column, reason: "is the target itself" });
      continue;
    }
    if (!LEAK_CATEGORIES.includes(f.category)) {
      withheld.push({ column, reason: `category "${f.category}" is not one of the allowed categories` });
      continue;
    }
    const key = `${column}|${f.category}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const base = {
      column,
      category: f.category,
      reason: text(f.reason, 400),
      engineFlagged: (relationships.leakageSuspects ?? []).some((l) => l.col === column),
    };
    findings.push({ ...base, ...CHECKS[f.category]({ f, column, data, result, withheld }) });
  }

  const engineOnly = (relationships.leakageSuspects ?? [])
    .filter((l) => !findings.some((f) => f.column === l.col))
    .map((l) => ({ column: l.col, warning: l.warning }));

  return { findings, split: verifySplit(answer.split, { data, result, known }), withheld, engineOnly };
}

const CHECKS = {
  derived_from_target: ({ f, column, data, result, withheld }) => {
    const formula = checkFormula(f.formula, column, result);
    if (formula?.problem) {
      withheld.push({ column, reason: `formula withheld: ${formula.problem}` });
      return { formula: null, measurement: null, verdict: "unchecked", verdictText: "No checkable formula was given; the claim rests on the column's meaning." };
    }
    if (!formula) {
      return { formula: null, measurement: null, verdict: "unchecked", verdictText: "No formula was proposed; the claim rests on the column's meaning." };
    }
    const m = evaluateFormula(data, formula);
    const shown = `${formula.result} = ${formula.terms.join(` ${OP_SYMBOL[formula.op]} `)}`;
    if (!m.n) return { formula, measurement: m, verdict: "unchecked", verdictText: `${shown} could not be checked — no row has all of these as numbers.` };
    const pct = (share) => `${Math.round(share * 1000) / 10}%`;
    const rows = m.n.toLocaleString();
    if (m.matchShare >= 0.95) {
      return { formula, measurement: m, verdict: "confirmed", verdictText: `${shown} holds on ${pct(m.matchShare)} of ${rows} rows checked.` };
    }
    if (m.fixedOffsetShare >= 0.9) {
      const amounts = m.fixedOffsets.filter((o) => o.offset !== 0).slice(0, 3)
        .map((o) => `${o.offset > 0 ? "+" : ""}${o.offset} on ${pct(o.share)}`).join(", ");
      return {
        formula, measurement: m, verdict: "partial",
        verdictText: `${shown} holds exactly on only ${pct(m.matchShare)} of ${rows} rows, but on ${pct(m.fixedOffsetShare)} the difference is one of a few fixed amounts (${amounts}) — likely a charge or constant the file does not record.`,
      };
    }
    return { formula, measurement: m, verdict: m.matchShare >= 0.5 ? "partial" : "contradicted", verdictText: `${shown} holds on ${pct(m.matchShare)} of ${rows} rows checked.` };
  },

  group_leak: ({ column, data, result }) => {
    const { meta } = result;
    const m = measureGroupLeak(data, column, meta.target, meta.columnRoles[meta.target]);
    if (m.repeatedRowShare === 0) {
      return { measurement: m, verdict: "contradicted", verdictText: `Every "${column}" value occurs on one row only, so no entity can appear on both sides of a split.` };
    }
    const shared = `${Math.round(m.repeatedRowShare * 100)}% of rows share a "${column}" value with another row (${m.groups.toLocaleString()} groups)`;
    if (m.purity != null) {
      const lift = m.purity - m.baseline;
      return {
        measurement: m,
        verdict: lift >= 0.1 ? "confirmed" : "partial",
        verdictText: `${shared}; within those groups the most common target value covers ${Math.round(m.purity * 100)}% of rows, against ${Math.round(m.baseline * 100)}% for the most common class overall.`,
      };
    }
    return {
      measurement: m,
      verdict: m.eta != null && m.eta >= 0.3 ? "confirmed" : "partial",
      verdictText: `${shared}; the group explains the target's ranks at η ${m.eta == null ? "—" : m.eta.toFixed(2)}.`,
    };
  },

  restates_label: ({ column, result }) => {
    const { relationships } = result;
    const tc = relationships.targetCorrelations?.[column];
    const presence = (relationships.presenceSignals ?? []).find((p) => p.col === column);
    const value = Math.max(tc?.absValue ?? 0, presence?.cramersV ?? 0);
    if (!tc && !presence) {
      return { measurement: null, verdict: "unchecked", verdictText: "The engine has no measured association for this column to check the claim against." };
    }
    const how = presence && presence.cramersV >= (tc?.absValue ?? 0)
      ? `whether "${column}" is recorded: Cramér's V ${presence.cramersV.toFixed(2)} (n ${presence.n.toLocaleString()})`
      : `${METRIC_LABEL[tc.metric] ?? tc.metric} ${tc.value.toFixed(2)} (n ${tc.n.toLocaleString()})`;
    const verdict = value >= RESTATES_CONFIRMED ? "confirmed" : value < RESTATES_WEAK ? "contradicted" : "partial";
    return { measurement: { value }, verdict, verdictText: `The engine measured ${how} against the target.` };
  },

  recorded_after_outcome: ({ column, result }) => ({
    measurement: null,
    verdict: "question",
    verdictText: `Timing cannot be read from the data. Is "${column}" known before "${result.meta.target}" is?`,
  }),
};

const OP_SYMBOL = { sum: "+", difference: "−", product: "×", ratio: "÷" };
const METRIC_LABEL = { pearson: "Pearson r", cramers_v: "Cramér's V", eta: "rank η" };

/* A formula is checkable only if every name is a real numeric column, the op is
   known, the arity fits, and it actually involves both the flagged column and the
   target — a formula that relates two other columns proves nothing about this one. */
function checkFormula(formula, column, result) {
  if (!formula) return null;
  const { meta } = result;
  const terms = Array.isArray(formula.terms) ? formula.terms.filter((t) => typeof t === "string") : [];
  const names = [formula.result, ...terms];
  if (!FORMULA_OPS.includes(formula.op)) return { problem: `operation "${formula.op}" is not supported` };
  if (terms.length < (formula.op === "sum" || formula.op === "product" ? 1 : 2)) return { problem: "too few terms" };
  if (formula.op === "ratio" && terms.length !== 2) return { problem: "a ratio takes exactly two terms" };
  const unknown = names.filter((n) => !(n in meta.columnRoles));
  if (unknown.length) return { problem: `${unknown.join(", ")} not a column in this file` };
  const nonNumeric = names.filter((n) => meta.columnRoles[n] !== ROLE.NUMERIC && meta.columnRoles[n] !== ROLE.BINARY);
  if (nonNumeric.length) return { problem: `${nonNumeric.join(", ")} not numeric` };
  if (!names.includes(column) || !names.includes(meta.target)) return { problem: `it does not involve both "${column}" and the target` };
  return { result: formula.result, op: formula.op, terms };
}

function verifySplit(split, { data, result, known }) {
  if (!split || !SPLIT_STRATEGIES.includes(split.strategy)) return null;
  const { meta } = result;
  const column = typeof split.column === "string" && known.has(split.column) ? split.column : null;
  const out = { strategy: split.strategy, column, reason: text(split.reason, 400), note: null };
  if (split.strategy === "time_ordered" && column && meta.columnRoles[column] !== ROLE.TEMPORAL) {
    out.note = `"${column}" is not read as a date column by the engine.`;
  }
  if (split.strategy === "grouped" && column) {
    const m = measureGroupLeak(data, column, meta.target, meta.columnRoles[meta.target]);
    out.note = `${Math.round(m.repeatedRowShare * 100)}% of rows share a "${column}" value with another row.`;
  }
  if (split.strategy !== "random" && !column) out.note = "No usable column was named for this split.";
  return out;
}
