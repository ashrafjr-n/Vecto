/* Column dossier (AI phase B) — the two pure halves that surround the model call.

   buildDossierPayload() decides EXACTLY what leaves the browser: per column, the
   engine's role, counts, a numeric summary, at most 8 top values and 5 short
   example values. No rows. Free-text columns send no values at all. Deterministic,
   so the preview shown to the user is byte-for-byte what is sent.

   verifyDossier() checks every claim in the model's answer against the data before
   anything is shown. A claim the data contradicts is labelled as contradicted; a
   claim about a column that does not exist is withheld and counted. The model's
   answer never reaches the engine — only a role the user accepts does, as a
   roleOverride. */

import { isMissing, isNumeric, normalizeValue, sharePct, minMax, median } from "../../components/utils/core/helpers.js";
import { isTemporalColumn } from "../../components/utils/core/detectors/temporal.js";
import { usableTargetColumns } from "../../components/utils/core/detectors/target.js";
import { ROLE } from "../../components/utils/core/roles.constants.js";
import { DOSSIER_ROLES, DOSSIER_SUBTYPES, DOSSIER_CONFIDENCE, DOSSIER_SENSITIVE, DOSSIER_TASKS, DOSSIER_MAX_COLUMNS } from "./dossierSchema.js";

const DISTINCT_CAP = 20000;   // same ceiling as roles.js CARD_CAP
const TOP_VALUES = 8;
const TOP_VALUES_MAX_LEVELS = 20;
const EXAMPLES = 5;
const EXAMPLE_SCAN_POINTS = 200;
const MAX_CHARS = 60;
const MAX_TARGETS = 3;

const clip = (s) => (s.length > MAX_CHARS ? `${s.slice(0, MAX_CHARS)}…` : s);
const sig = (x) => Number(x.toPrecision(6));

/* The engine's detectTarget() guess is deliberately NOT sent. Measured on the eval
   (2026-09-14): both of the model's wrong top targets — penguins "sex", taxis
   "dropoff_borough" — were exactly the engine's wrong guess, while on files where
   the engine guessed wrong and the model had to judge alone it was right. */
export function buildDossierPayload(data, columns, roles) {
  return {
    schemaVersion: 1,
    rows: data.length,
    columns: columns.slice(0, DOSSIER_MAX_COLUMNS).map((col) => profileForAi(data, col, roles[col])),
  };
}

function profileForAi(data, col, role) {
  let present = 0;
  let totalLength = 0;
  let allIntegers = true;
  const numbers = [];
  const nonNumeric = new Set();
  const levels = new Map();
  let overflow = false;

  for (let i = 0; i < data.length; i++) {
    const raw = data[i][col];
    if (isMissing(raw)) continue;
    present++;
    const str = String(raw).trim();
    totalLength += str.length;

    if (isNumeric(raw)) {
      const n = parseFloat(raw);
      numbers.push(n);
      if (!Number.isInteger(n)) allIntegers = false;
    } else if (nonNumeric.size < 3) {
      nonNumeric.add(clip(str));
    }

    if (!overflow) {
      const key = normalizeValue(raw);
      const hit = levels.get(key);
      if (hit) hit.count++;
      else if (levels.size >= DISTINCT_CAP) overflow = true;
      else levels.set(key, { value: str, count: 1 });
    }
  }

  const isText = role === ROLE.TEXT;
  const profile = {
    name: col,
    engineRole: role ?? null,
    missingPct: sharePct(data.length - present, data.length),
    distinct: overflow ? `>${DISTINCT_CAP}` : levels.size,
    numericShare: present ? Math.round((numbers.length / present) * 100) / 100 : 0,
  };

  if (numbers.length) profile.allIntegers = allIntegers;
  if (present && numbers.length / present >= 0.8) {
    const { min, max } = minMax(numbers);
    profile.summary = { min: sig(min), median: sig(median(numbers)), max: sig(max) };
    // The values that did NOT parse are the evidence for a unit or a censored value ("125+").
    if (nonNumeric.size) profile.nonNumericExamples = [...nonNumeric];
  }

  if (isText) {
    profile.avgLength = present ? Math.round(totalLength / present) : 0;
    return profile;
  }

  if (!overflow && levels.size <= TOP_VALUES_MAX_LEVELS) {
    profile.topValues = [...levels.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, TOP_VALUES)
      .map(({ value, count }) => [clip(value), count]);
  }
  profile.examples = spreadExamples(data, col);
  return profile;
}

// Distinct values taken from evenly spaced rows, so they are not all from the file's head.
function spreadExamples(data, col) {
  const out = new Set();
  const step = Math.max(1, Math.floor(data.length / EXAMPLE_SCAN_POINTS));
  for (let i = 0; i < data.length && out.size < EXAMPLES; i += step) {
    const raw = data[i][col];
    if (!isMissing(raw)) out.add(clip(String(raw).trim()));
  }
  return [...out];
}


/* ── Verification ─────────────────────────────────────────────────────────── */

const pick = (value, allowed) => (allowed.includes(value) ? value : null);
const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/* `roles` are the engine's roles with no target (what the picker shows).
   Returns { rowGrain, columns, targets, withheld, undescribed } or { error }. */
export function verifyDossier(response, { data, columns, roles }) {
  if (!response || !Array.isArray(response.columns)) {
    return { error: "The model's answer did not have the expected shape." };
  }

  const known = new Set(columns);
  const seen = new Set();
  const withheld = [];
  const verified = [];

  for (const entry of response.columns) {
    const name = entry?.name;
    if (typeof name !== "string" || !known.has(name)) {
      withheld.push({ column: String(name), reason: "not a column in this file" });
      continue;
    }
    if (seen.has(name)) continue;
    seen.add(name);
    if (!DOSSIER_ROLES.includes(entry.role)) {
      withheld.push({ column: name, reason: `role "${entry.role}" is not one of the allowed roles` });
      continue;
    }

    const facts = columnFacts(data, name);
    const subtype = pick(entry.subtype, DOSSIER_SUBTYPES);
    const range = entry.validRange;
    const hasRange = range && (Number.isFinite(range.min) || Number.isFinite(range.max));
    const evidence = checkEvidence(entry.evidence, data, name, known);
    if (evidence.removed) withheld.push({ column: name, reason: `${evidence.removed} evidence quote(s) not found in the column` });

    verified.push({
      name,
      meaning: text(entry.meaning, 300),
      role: entry.role,
      engineRole: roles[name],
      agrees: entry.role === roles[name],
      roleContradiction: entry.role === roles[name] ? null : roleContradiction(entry.role, facts),
      subtype,
      subtypeContradiction: subtype === "count" && !facts.nonNegativeIntegers
        ? "not every value is a whole number of zero or more" : null,
      unit: text(entry.unit, 40) || null,
      validRange: hasRange ? { min: finiteOrNull(range.min), max: finiteOrNull(range.max) } : null,
      outOfRange: hasRange && facts.numbers.length ? countOutside(facts.numbers, range) : null,
      /* pick() returns null for anything off the list, which is also the "not a
         sensitive attribute" answer — the two collapse on purpose. An invented value
         must not reach the page, and the safe fallback for a claim about a person is
         to make no claim. */
      sensitive: pick(entry.sensitive, DOSSIER_SENSITIVE),
      confidence: pick(entry.confidence, DOSSIER_CONFIDENCE),
      evidence: evidence.kept,
    });
  }

  const usable = new Set(usableTargetColumns(columns, data, roles));
  const targets = [];
  for (const cand of Array.isArray(response.targetCandidates) ? response.targetCandidates : []) {
    const column = cand?.column;
    if (typeof column !== "string" || targets.some((t) => t.column === column)) continue;
    if (!usable.has(column)) {
      withheld.push({ column, reason: known.has(column)
        ? "suggested as a target, but it is not usable as one (needs a numeric, binary or categorical role, two or more values, and at least half the rows present)"
        : "suggested as a target, but it is not a column in this file" });
      continue;
    }
    targets.push({ column, task: pick(cand.task, DOSSIER_TASKS), reason: text(cand.reason, 300) });
    if (targets.length === MAX_TARGETS) break;
  }

  return {
    rowGrain: text(response.rowGrain, 200),
    columns: verified,
    targets,
    withheld,
    undescribed: columns.filter((c) => !seen.has(c)),
  };
}

function columnFacts(data, col) {
  let present = 0;
  let nonNegativeIntegers = true;
  const numbers = [];
  const levels = new Set();
  for (let i = 0; i < data.length; i++) {
    const raw = data[i][col];
    if (isMissing(raw)) continue;
    present++;
    if (isNumeric(raw)) {
      const n = parseFloat(raw);
      numbers.push(n);
      if (!Number.isInteger(n) || n < 0) nonNegativeIntegers = false;
    } else {
      nonNegativeIntegers = false;
    }
    if (levels.size < 3) levels.add(normalizeValue(raw));
  }
  const sample = data.slice(0, 100).map((r) => r[col]).filter((v) => !isMissing(v));
  return { present, numbers, distinct: levels.size, nonNegativeIntegers: present > 0 && nonNegativeIntegers, sample };
}

/* The same bars detectColumnRoles applies, asked of the AI's role. null = the data
   does not contradict it. Categorical and free text are never contradicted by
   values alone — they are claims about meaning. */
function roleContradiction(role, facts) {
  if (facts.present === 0) return "the column has no values";
  switch (role) {
    case ROLE.NUMERIC:
      return facts.numbers.length / facts.present >= 0.8
        ? null : `only ${sharePct(facts.numbers.length, facts.present)}% of its values are numbers`;
    case ROLE.BINARY:
      return facts.distinct === 2 ? null
        : facts.distinct < 2 ? "it has a single value" : "it has more than two distinct values";
    case ROLE.TEMPORAL:
      return facts.sample.length && isTemporalColumn(facts.sample) ? null : "its values do not read as dates";
    case ROLE.IDENTIFIER:
      return facts.distinct < 2 ? "it has a single value" : null;
    default:
      return null;
  }
}

const finiteOrNull = (x) => (Number.isFinite(x) ? x : null);

function countOutside(numbers, { min, max }) {
  let n = 0;
  for (const v of numbers) {
    if ((Number.isFinite(min) && v < min) || (Number.isFinite(max) && v > max)) n++;
  }
  return n;
}

/* Evidence may quote values in double quotes. Every quote must be a value that
   occurs in the column (or a column name); an item with an invented quote is
   removed rather than shown. */
function checkEvidence(evidence, data, col, columnNames) {
  if (!Array.isArray(evidence)) return { kept: [], removed: 0 };
  let values = null;
  const kept = [];
  let removed = 0;
  for (const item of evidence.slice(0, 3)) {
    if (typeof item !== "string") continue;
    const quotes = [...item.matchAll(/"([^"]+)"/g)].map((m) => m[1].trim());
    if (quotes.length && !values) {
      values = new Set();
      for (let i = 0; i < data.length; i++) if (!isMissing(data[i][col])) values.add(String(data[i][col]).trim());
    }
    if (quotes.every((q) => values.has(q) || columnNames.has(q))) kept.push(item.slice(0, 200));
    else removed++;
  }
  return { kept, removed };
}
