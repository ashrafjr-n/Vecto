/* Cleaning proposals (AI phase D) — everything around the model call that is not
   the model: finding candidates, applying rules, measuring them, exporting them.

   findCleaningCandidates() is deterministic. The engine finds WHAT looks dirty —
     numeric_affix    numbers written with a unit, scale word, symbol or bound
                      ("42 Lac", "500 sqft", "125+", "$1200")
     level_collision  category levels that differ only by case, spacing or
                      punctuation ("Semi-Furnished" / "semi furnished")
     sentinel         a placeholder at the edge of a numeric column (-999, 9999)
   — and the model only judges what each one MEANS (is "Lac" 100,000? is -999 a
   code?). That keeps rows away from the model: the payload carries candidate
   groups with counts and at most 3 short examples each.

   applyCleaningRules() never mutates its input, and verifyCleaningRules() applies
   each rule on its own and reports what it changed before anything is offered. */

import { isMissing, isNumeric, normalizeValue, valueFrequencies, minMax, median } from "../../components/utils/core/helpers.js";
import { ROLE } from "../../components/utils/core/roles.constants.js";
import { RULE_TYPES, CLEANING_MAX_COLUMNS } from "./cleaningSchema.js";

const MAX_CHARS = 60;
const EXAMPLES = 3;
const MAX_AFFIX_GROUPS = 8;
const MAX_COLLISION_GROUPS = 10;
const MAX_LEVELS_FOR_COLLISIONS = 5000;
const SENTINELS = [-99999, -9999, -999, -99, 999, 9999, 99999];

const clip = (s) => (s.length > MAX_CHARS ? `${s.slice(0, MAX_CHARS)}…` : s);

/* A number with thousands separators or decimals, and an affix on ONE side that
   holds no digits: "42 Lac", "1.4 Cr", "125+", "500sqft", "$1,200", "₹ 45".
   "2,600 to 5,200" does not match — a range is not a unit, and no rule below could
   express it.

   A PREFIX must be symbols, never letters. Measured on the corpus: a letter prefix
   turned codes into "units" — diamonds' clarity "SI2"/"VVS1", ginf's league "E0",
   titanic's Cabin "C85" and Ticket "PC 17599". A unit written before a number is a
   currency sign; a word before a number is a code. */
const NUMBER = String.raw`[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?`;
const SUFFIXED = new RegExp(String.raw`^\s*(${NUMBER})\s*([^\d\s][^\d]{0,15}?)\s*$`);
const PREFIXED = new RegExp(String.raw`^\s*([^\p{L}\d\s+\-.]{1,3})\s*(${NUMBER})\s*$`, "u");

/* → { number, affix } for an affixed number, null otherwise. The affix is the
   lowercased, trimmed text beside the number — the key rules are written against. */
export function parseAffixed(raw) {
  const s = String(raw);
  let m = SUFFIXED.exec(s);
  if (m) return { number: parseFloat(m[1].replace(/,/g, "")), affix: m[2].trim().toLowerCase() };
  m = PREFIXED.exec(s);
  if (m) return { number: parseFloat(m[2].replace(/,/g, "")), affix: m[1].trim().toLowerCase() };
  return null;
}

/* Two levels collide when they are equal after dropping everything but letters and
   digits — "R-JR" / "R JR" / "RJR", "Las Vegas" / "LasVegas", events' broken
   encodings "adria¡n" / "adrian". A point BETWEEN digits is kept: house_prices'
   "85 Lac" and "8.5 Lac" are different amounts, and collided without it. So are a
   comma between digits, a minus that starts a number and < > =: AirQualityUCI's
   "-1,4" / "1,4" and "-200" / "20,0", and adult's "<=50K" / ">50K", collided and were
   merged by the model. Each kept symbol gets its own private-use placeholder. */
const collisionKey = (v) => normalizeValue(v)
  .replace(/(\d)([.,])(?=\d)/g, (_, d, sep) => d + (sep === "." ? "\uE000" : "\uE001"))
  .replace(/(^|[^\p{L}\p{N}])-(?=\d)/gu, "$1\uE002")
  .replace(/[<>=]/g, (c) => ({ "<": "\uE003", ">": "\uE004", "=": "\uE005" })[c])
  .replace(/[^\p{L}\p{N}\uE000-\uE005]/gu, "");

export function findCleaningCandidates(data, columns, roles) {
  const out = [];
  for (const col of columns) {
    const role = roles[col];
    if (role === ROLE.IDENTIFIER || role === ROLE.TEXT || role === ROLE.TEMPORAL) continue;
    const candidates = [];

    let present = 0;
    let plain = 0;
    const affixes = new Map();
    const numbers = [];
    for (let i = 0; i < data.length; i++) {
      const raw = data[i][col];
      if (isMissing(raw)) continue;
      present++;
      if (isNumeric(raw)) { plain++; numbers.push(parseFloat(raw)); continue; }
      const hit = parseAffixed(raw);
      if (!hit) continue;
      let g = affixes.get(hit.affix);
      if (!g) affixes.set(hit.affix, (g = { affix: hit.affix, count: 0, examples: [] }));
      g.count++;
      if (g.examples.length < EXAMPLES && !g.examples.includes(clip(String(raw).trim()))) g.examples.push(clip(String(raw).trim()));
    }
    if (!present) continue;

    const affixed = [...affixes.values()].reduce((n, g) => n + g.count, 0);
    if (affixed >= Math.max(5, 0.01 * present) && (plain + affixed) / present >= 0.5) {
      candidates.push({
        kind: "numeric_affix",
        plainNumbers: plain,
        affixes: [...affixes.values()].sort((a, b) => b.count - a.count).slice(0, MAX_AFFIX_GROUPS),
      });
    }

    if (role === ROLE.NUMERIC && numbers.length) {
      const { min, max } = minMax(numbers);
      for (const s of SENTINELS) {
        if (s !== min && s !== max) continue;
        const count = numbers.reduce((n, v) => n + (v === s), 0);
        if (count >= 5 && count / present >= 0.01) {
          candidates.push({ kind: "sentinel", value: String(s), count, columnMedian: median(numbers) });
        }
      }
    }

    if (role === ROLE.CATEGORICAL || role === ROLE.BINARY) {
      const levels = valueFrequencies(data, col);
      if (levels.length <= MAX_LEVELS_FOR_COLLISIONS) {
        const byKey = new Map();
        for (const l of levels) {
          const k = collisionKey(l.value);
          if (!k) continue;
          if (!byKey.has(k)) byKey.set(k, []);
          byKey.get(k).push([clip(l.value), l.count]);
        }
        const groups = [...byKey.values()].filter((g) => g.length > 1).slice(0, MAX_COLLISION_GROUPS);
        if (groups.length) candidates.push({ kind: "level_collision", groups });
      }
    }

    if (candidates.length) out.push({ name: col, role, present, candidates });
    if (out.length === CLEANING_MAX_COLUMNS) break;
  }
  return out;
}

/* ── Rules the engine can write itself ──────────────────────────────────────
   Some candidates have one meaning whatever the file is about, so they need no model:
     a currency sign or code        "$1,200" → 1200            (factor 1)
     a percent sign                 "25%"    → 25, or 0.25 when the plain numbers are fractions
     a scale word                   "42 Lac" → 4200000         (k, thousand, lakh, crore, mn, bn…)
     a bound                        "125+", "<5" → the bound   (censored_numeric)
     spellings of one level         "semi furnished" → "Semi-Furnished", the commonest spelling
     a placeholder far outside the real values   -999 among ages 18-90 → missing
   A physical unit ("sqft", "kg") is NOT here: whether the plain numbers are in the same
   unit is a fact about the file, and that is what the optional AI review is asked.
   "m" is not here either — metres or million. The output is the same { rules } shape
   the model answers in, so it goes through verifyCleaningRules like any answer. */
const CURRENCY = new Set(["$", "€", "£", "¥", "₹", "usd", "eur", "gbp", "inr", "rs", "rs.", "sar", "aed", "ils", "₪"]);
const SCALE = {
  k: 1e3, thousand: 1e3, thousands: 1e3,
  lac: 1e5, lacs: 1e5, lakh: 1e5, lakhs: 1e5, l: 1e5,
  cr: 1e7, crore: 1e7, crores: 1e7,
  mn: 1e6, million: 1e6, millions: 1e6,
  bn: 1e9, billion: 1e9, billions: 1e9,
};
const BOUNDS = new Set(["+", "<", ">", "<=", ">=", "≤", "≥"]);
/* A placeholder is "far outside" when the gap to the nearest real value is more than
   this many interquartile ranges of the real values. */
const SENTINEL_GAP_IQR = 3;
const fmt = (n) => n.toLocaleString("en-US");

export function proposeEngineRules(candidates, data) {
  const rules = [];
  for (const col of candidates) {
    for (const c of col.candidates) {
      if (c.kind === "numeric_affix") {
        const units = [], bounds = [], notes = [];
        let plainMedian = null;
        for (const a of c.affixes) {
          if (BOUNDS.has(a.affix)) { bounds.push(a.affix); continue; }
          if (CURRENCY.has(a.affix)) { units.push({ affix: a.affix, factor: 1 }); notes.push(`"${a.affix}" is a currency mark`); continue; }
          if (SCALE[a.affix]) { units.push({ affix: a.affix, factor: SCALE[a.affix] }); notes.push(`"${a.affix}" is ${fmt(SCALE[a.affix])}`); continue; }
          if (a.affix === "%") {
            if (plainMedian === null) {
              const plain = [];
              for (const row of data) { const v = row[col.name]; if (!isMissing(v) && isNumeric(v)) plain.push(parseFloat(v)); }
              plainMedian = plain.length ? median(plain) : null;
            }
            const fraction = plainMedian !== null && Math.abs(plainMedian) <= 1;
            units.push({ affix: "%", factor: fraction ? 0.01 : 1 });
            notes.push(fraction ? `"25%" is 0.25, since the plain numbers are fractions` : `"%" is a percent sign`);
          }
        }
        if (units.length) rules.push({ column: col.name, type: "unit_map", reason: `${notes.join("; ")}.`, affixes: units, values: [], merges: [] });
        if (bounds.length) {
          rules.push({ column: col.name, type: "censored_numeric", reason: `${bounds.map((b) => `"${b}"`).join(", ")} marks an open-ended value; it is read as its bound, and the report says the column holds bounds.`, affixes: bounds.map((b) => ({ affix: b, factor: 1 })), values: [], merges: [] });
        }
      } else if (c.kind === "level_collision") {
        const merges = [];
        for (const group of c.groups) {
          if (group.some(([v]) => v.endsWith("…"))) continue;   // a clipped value is not the level itself
          const [to] = [...group].sort((x, y) => y[1] - x[1])[0];
          for (const [from] of group) if (from !== to) merges.push({ from, to });
        }
        if (merges.length) rules.push({ column: col.name, type: "merge_levels", reason: "The same level written with different case, spacing or punctuation; each is merged into its commonest spelling.", affixes: [], values: [], merges });
      } else if (c.kind === "sentinel") {
        const s = Number(c.value);
        const real = [];
        for (const row of data) { const v = row[col.name]; if (!isMissing(v) && isNumeric(v) && parseFloat(v) !== s) real.push(parseFloat(v)); }
        if (real.length < 10) continue;
        real.sort((x, y) => x - y);
        const q = (p) => real[Math.floor(p * (real.length - 1))];
        const iqr = q(0.75) - q(0.25);
        const gap = s < real[0] ? real[0] - s : s > real[real.length - 1] ? s - real[real.length - 1] : 0;
        if (gap > SENTINEL_GAP_IQR * Math.max(iqr, Number.EPSILON)) {
          rules.push({ column: col.name, type: "treat_as_missing", reason: `${c.value} appears on ${fmt(c.count)} rows, far outside the column's other values (${fmt(real[0])} to ${fmt(real[real.length - 1])}) — a placeholder for "unknown", not a measurement.`, affixes: [], values: [c.value], merges: [] });
        }
      }
    }
  }
  return { rules };
}

/* ── Applying ─────────────────────────────────────────────────────────────── */

const tidy = (x) => String(Number(x.toPrecision(12)));

/* One rule as a value → value function. `null` means "leave the value alone". */
function ruleFunction(rule) {
  if (rule.type === "unit_map" || rule.type === "censored_numeric") {
    const factors = new Map(rule.affixes.map((a) => [a.affix.trim().toLowerCase(), rule.type === "unit_map" ? a.factor : 1]));
    return (raw) => {
      if (isMissing(raw) || isNumeric(raw)) return null;
      const hit = parseAffixed(raw);
      return hit && factors.has(hit.affix) ? tidy(hit.number * factors.get(hit.affix)) : null;
    };
  }
  if (rule.type === "treat_as_missing") {
    const values = new Set(rule.values.map((v) => normalizeValue(v)));
    return (raw) => (!isMissing(raw) && values.has(normalizeValue(raw)) ? "" : null);
  }
  const merges = new Map(rule.merges.map((m) => [normalizeValue(m.from), m.to]));
  return (raw) => {
    if (isMissing(raw)) return null;
    const to = merges.get(normalizeValue(raw));
    return to !== undefined && String(raw).trim() !== to ? to : null;
  };
}

/* → { data, changed: [rowsChanged per rule] }. Rows are copied only where a value
   changes, so the untouched majority of a large file is shared, not duplicated. */
export function applyCleaningRules(data, rules) {
  if (!rules.length) return { data, changed: [] };
  const fns = rules.map(ruleFunction);
  const changed = rules.map(() => 0);
  const out = new Array(data.length);
  for (let i = 0; i < data.length; i++) {
    let row = data[i];
    for (let r = 0; r < rules.length; r++) {
      const next = fns[r](row[rules[r].column]);
      if (next === null) continue;
      if (row === data[i]) row = { ...row };
      row[rules[r].column] = next;
      changed[r]++;
    }
    out[i] = row;
  }
  return { data: out, changed };
}


/* ── Verifying ────────────────────────────────────────────────────────────── */

const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

function columnShape(data, col) {
  let present = 0;
  let numeric = 0;
  const levels = new Set();
  for (let i = 0; i < data.length; i++) {
    const raw = data[i][col];
    if (isMissing(raw)) continue;
    present++;
    if (isNumeric(raw)) numeric++;
    if (levels.size <= 20000) levels.add(normalizeValue(raw));
  }
  return { present, numericShare: present ? numeric / present : 0, levels: levels.size };
}

/* → { rules, withheld } or { error }. Each rule is checked against the candidates
   the engine found (an affix the column does not contain is dropped), then applied
   ALONE to measure it: rows changed, share of values that are numbers before and
   after, distinct levels before and after, and up to three before → after pairs.
   `effective` is false for a rule that changes nothing — it is shown, never offered. */
export function verifyCleaningRules(answer, { data, columns, candidates }) {
  if (!answer || !Array.isArray(answer.rules)) return { error: "The model's answer did not have the expected shape." };
  const known = new Set(columns);
  const byCol = new Map(candidates.map((c) => [c.name, c]));
  const withheld = [];
  const rules = [];
  const seen = new Set();

  for (const r of answer.rules) {
    const column = r?.column;
    if (typeof column !== "string" || !known.has(column)) { withheld.push({ column: String(column), reason: "not a column in this file" }); continue; }
    if (!RULE_TYPES.includes(r.type)) { withheld.push({ column, reason: `rule type "${r.type}" is not supported` }); continue; }
    const key = `${column}|${r.type}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const rule = sanitize(r, column, byCol.get(column), data, withheld);
    if (!rule) continue;

    const before = columnShape(data, column);
    const { data: after, changed } = applyCleaningRules(data, [rule]);
    const shape = columnShape(after, column);
    const examples = [];
    for (let i = 0; i < data.length && examples.length < 3; i++) {
      if (after[i] !== data[i] && !examples.some((e) => e.before === String(data[i][column]))) {
        examples.push({ before: String(data[i][column]), after: after[i][column] === "" ? "(missing)" : after[i][column] });
      }
    }
    rules.push({
      ...rule,
      reason: text(r.reason, 400),
      measurement: { rowsChanged: changed[0], numericShareBefore: before.numericShare, numericShareAfter: shape.numericShare, levelsBefore: before.levels, levelsAfter: shape.levels, examples },
      effective: changed[0] > 0,
    });
  }
  return { rules, withheld };
}

function sanitize(r, column, candidate, data, withheld) {
  const affixKinds = candidate?.candidates.find((c) => c.kind === "numeric_affix")?.affixes.map((a) => a.affix) ?? [];
  if (r.type === "unit_map" || r.type === "censored_numeric") {
    const affixes = (Array.isArray(r.affixes) ? r.affixes : [])
      .map((a) => ({ affix: text(a?.affix, 16).toLowerCase(), factor: r.type === "unit_map" ? a?.factor : 1 }))
      .filter((a) => {
        const ok = affixKinds.includes(a.affix) && Number.isFinite(a.factor) && a.factor > 0;
        if (!ok) withheld.push({ column, reason: `affix "${a.affix}" dropped — ${affixKinds.includes(a.affix) ? "its factor is not a positive number" : "the column contains no number written with it"}` });
        return ok;
      });
    if (!affixes.length) return null;
    return { column, type: r.type, affixes, values: [], merges: [] };
  }
  if (r.type === "treat_as_missing") {
    const present = new Set();
    for (let i = 0; i < data.length; i++) if (!isMissing(data[i][column])) present.add(normalizeValue(data[i][column]));
    const values = (Array.isArray(r.values) ? r.values : []).map((v) => text(v, 60)).filter((v) => {
      const ok = v !== "" && present.has(normalizeValue(v));
      if (!ok) withheld.push({ column, reason: `"${v}" dropped — it does not occur in the column` });
      return ok;
    });
    return values.length ? { column, type: r.type, affixes: [], values, merges: [] } : null;
  }
  const levels = new Set(valueFrequencies(data, column).map((l) => normalizeValue(l.value)));
  const merges = (Array.isArray(r.merges) ? r.merges : [])
    .map((m) => ({ from: text(m?.from, 60), to: text(m?.to, 60) }))
    .filter((m) => {
      if (!levels.has(normalizeValue(m.from)) || !levels.has(normalizeValue(m.to))) {
        withheld.push({ column, reason: `merge "${m.from}" → "${m.to}" dropped — both sides must be levels that occur in the column` });
        return false;
      }
      // The model is asked to merge within a collision group; a pair outside one is two values.
      if (collisionKey(m.from) !== collisionKey(m.to)) {
        withheld.push({ column, reason: `merge "${m.from}" → "${m.to}" dropped — the two levels differ by more than case, spacing or punctuation` });
        return false;
      }
      return true;
    });
  return merges.length ? { column, type: r.type, affixes: [], values: [], merges } : null;
}


/* ── Export ───────────────────────────────────────────────────────────────── */

const py = (s) => JSON.stringify(s);   // a JSON string literal is a valid Python str literal for these values
const NUMBER_RE = String.raw`[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?`;

/* The accepted rules as a pandas snippet, so the cleaning can be reproduced in the
   user's own pipeline. Mechanical — no model involved — and it applies the same
   semantics as applyCleaningRules(): affix matched case-insensitively on either
   side of the number, merges and placeholders matched after trimming and lowercasing. */
export function cleaningRulesToPandas(rules) {
  const lines = [
    "import re",
    "import numpy as np",
    "import pandas as pd",
    "",
    "# Read every column as text so the rules see the values as written.",
    'df = pd.read_csv("your_file.csv", dtype=str, keep_default_na=False)',
    "",
    "def _affixed(value, factors):",
    `    m = re.match(r"^\\s*(${NUMBER_RE})\\s*([^\\d\\s][^\\d]{0,15}?)\\s*$", value)`,
    "    if m:",
    "        number, affix = m.group(1), m.group(2)",
    "    else:",
    `        m = re.match(r"^\\s*([^\\w\\s+\\-.]{1,3})\\s*(${NUMBER_RE})\\s*$", value)`,
    "        if not m:",
    "            return value",
    "        affix, number = m.group(1), m.group(2)",
    "    factor = factors.get(affix.strip().lower())",
    "    return value if factor is None else repr(float(number.replace(',', '')) * factor)",
    "",
  ];
  for (const r of rules) {
    const col = py(r.column);
    if (r.type === "unit_map" || r.type === "censored_numeric") {
      const factors = `{${r.affixes.map((a) => `${py(a.affix)}: ${r.type === "unit_map" ? a.factor : 1}`).join(", ")}}`;
      lines.push(`# ${r.type}: ${r.column}`, `df[${col}] = df[${col}].map(lambda v: _affixed(v, ${factors}))`);
    } else if (r.type === "treat_as_missing") {
      lines.push(`# treat_as_missing: ${r.column}`, `df.loc[df[${col}].str.strip().str.lower().isin([${r.values.map((v) => py(v.trim().toLowerCase())).join(", ")}]), ${col}] = np.nan`);
    } else {
      const map = `{${r.merges.map((m) => `${py(m.from.trim().toLowerCase())}: ${py(m.to)}`).join(", ")}}`;
      lines.push(`# merge_levels: ${r.column}`, `df[${col}] = df[${col}].map(lambda v: ${map}.get(v.strip().lower(), v))`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
