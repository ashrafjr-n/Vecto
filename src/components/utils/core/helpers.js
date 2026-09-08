/* ─────────────────────────────────────────────
   Datassert HELPERS — shared pure utilities
   No imports. Used by all other modules.
───────────────────────────────────────────── */

export function isNumeric(val) {
  if (val === null || val === undefined || val === "") return false;
  return !isNaN(parseFloat(val)) && isFinite(val);
}

export function getValues(data, col) {
  return data.map(r => r[col]).filter(v => v !== "" && v != null);
}

export function getNumericValues(data, col) {
  return getValues(data, col).map(v => parseFloat(v)).filter(v => !isNaN(v));
}

/* ── FIX #3: shared missing-value detection (matches reference harness) ── */
export const MISSING_TOKENS = new Set(["", "na", "n/a", "nan", "null", "none", "?"]);
export function isMissing(v) {
  if (v == null) return true;                 // null or undefined
  if (typeof v !== "string") return Number.isNaN(v);  // stray NaN number
  return MISSING_TOKENS.has(v.trim().toLowerCase());  // trims whitespace-only too
}

/* ── The ONE canonical value normalizer ──
   Three policies used to coexist: roles.js lowercased+trimmed, classBalance and
   visualizations keyed on the raw string, and Cramer's V trimmed only. So
   " Male ", "MALE" and "male" were a single level to role detection and three
   separate classes in the report rendered right next to it — a column could be
   labelled binary above a list of four classes.

   This returns a GROUPING KEY, not a label: numeric-looking values by their
   parsed value (so "1", "1.0" and " 1 " are one level), everything else
   lowercased and trimmed. For anything a user reads, group by this key but
   display an original spelling — see valueFrequencies(). */
export function normalizeValue(v) {
  return isNumeric(v) ? String(parseFloat(v)) : String(v).toLowerCase().trim();
}

/* Level frequencies for a column, grouped by the canonical key but LABELLED with
   the first spelling seen in the file, so collapsing " Male "/"MALE"/"male" into
   one class still displays it as "Male" and not as a lowercased key. Missing
   tokens are excluded, matching every other consumer of a column's levels.
   Returns [{ value, count }], most frequent first. */
export function valueFrequencies(data, col) {
  const groups = new Map();
  for (let i = 0; i < data.length; i++) {
    const raw = data[i][col];
    if (isMissing(raw)) continue;
    const key = normalizeValue(raw);
    const hit = groups.get(key);
    if (hit) hit.count++;
    else groups.set(key, { value: String(raw).trim(), count: 1 });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

export function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid    = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function stdDev(arr) {
  if (arr.length < 2) return 0;
  const m   = mean(arr);
  const sum = arr.reduce((acc, v) => acc + (v - m) ** 2, 0);
  return Math.sqrt(sum / (arr.length - 1));   // ddof=1 (sample std)
}

/* ── FIX #2: moment-based, bias-corrected skewness (scipy.stats.skew bias=False) ── */
export function skewness(arr) {
  const n = arr.length;
  if (n < 3) return 0;                         // bias-correction undefined for n<3
  const m = mean(arr);
  const m2 = arr.reduce((a, v) => a + (v - m) ** 2, 0) / n;  // central moments divide by n
  const m3 = arr.reduce((a, v) => a + (v - m) ** 3, 0) / n;
  if (m2 === 0) return 0;                       // zero variance → undefined, return 0
  const g1 = m3 / m2 ** 1.5;                    // biased sample skewness
  return (Math.sqrt(n * (n - 1)) / (n - 2)) * g1;  // bias-corrected G1 (scipy bias=False)
}

/* ── FIX #2: excess kurtosis, bias-corrected (scipy.stats.kurtosis bias=False, fisher=True) ── */
export function kurtosis(arr) {
  const n = arr.length;
  if (n < 4) return 0;                          // bias-corrected excess kurtosis undefined for n<4
  const m = mean(arr);
  const m2 = arr.reduce((a, v) => a + (v - m) ** 2, 0) / n;
  const m4 = arr.reduce((a, v) => a + (v - m) ** 4, 0) / n;
  if (m2 === 0) return 0;
  const g2 = m4 / (m2 * m2) - 3;                // biased excess kurtosis
  // bias-corrected (scipy fisher=True, bias=False):
  return ((n - 1) / ((n - 2) * (n - 3))) * ((n + 1) * g2 + 6);
}

/* ── FIX #5a: correlation ratio η — numeric-feature ↔ categorical association ──
   η² = SS_between / SS_total, where
     SS_between = Σ_g n_g (mean_g − mean_overall)²
     SS_total   = Σ_i (x_i − mean_overall)²
   η = sqrt(η²), range [0, 1]. Inputs must be paired & missing-free; caller
   excludes missing (via isMissing) on both the value and the label. */
export function etaCorrelation(numericValues, categoryLabels) {
  const n = numericValues.length;
  if (n < 3 || n !== categoryLabels.length) return 0;

  const grand = mean(numericValues);
  const ssTotal = numericValues.reduce((s, v) => s + (v - grand) ** 2, 0);
  if (ssTotal === 0) return 0;                 // constant numeric column → nothing to explain

  // group values by label
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const g = categoryLabels[i];
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(numericValues[i]);
  }
  if (groups.size < 2) return 0;               // need ≥2 categories

  let ssBetween = 0;
  for (const vals of groups.values()) {
    const gm = mean(vals);
    ssBetween += vals.length * (gm - grand) ** 2;
  }
  return Math.sqrt(ssBetween / ssTotal);
}

export function quantile(arr, q) {
  const sorted = [...arr].sort((a, b) => a - b);
  const pos    = (sorted.length - 1) * q;
  const base   = Math.floor(pos);
  const rest   = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

/* ── FIX #1: Pearson uses paired rows to handle missing values correctly ── */
export function pearson(data, colA, colB) {
  const pairs = [];
  data.forEach(row => {
    const a = parseFloat(row[colA]);
    const b = parseFloat(row[colB]);
    if (!isNaN(a) && !isNaN(b)) pairs.push([a, b]);
  });

  const n = pairs.length;
  if (n < 3) return 0;

  const mx = mean(pairs.map(p => p[0]));
  const my = mean(pairs.map(p => p[1]));

  let num = 0, dx2 = 0, dy2 = 0;
  for (const [a, b] of pairs) {
    const dx = a - mx;
    const dy = b - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }

  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? 0 : Math.round((num / denom) * 100) / 100;
}

/* ── FIX #8: isIdentifierCol — guard against year-like sequential features ── */
export function isIdentifierCol(data, col) {
  const nameLower = col.toLowerCase();

  // Name heuristic — must contain id/uuid/key/index at a word boundary
  const idNamePattern = /(\b|_)(id|uuid|key|index|ref)(\b|_|$)/i;
  if (idNamePattern.test(nameLower)) {
    const vals   = getValues(data, col);
    const unique = new Set(vals.map(String)).size;
    if (unique / data.length > 0.9) return true;
  }

  // Uniqueness + sequential heuristic
  // Excluded: "no", "num", "number", "code" — too likely to be real features (year, score, code)
  const vals = data.slice(0, 200).map(r => r[col]).filter(v => v !== "" && v != null);

  // FIX: guard against all-missing column
  if (vals.length === 0) return false;

  const unique = new Set(vals.map(String)).size;

  if (unique / vals.length > 0.95 && vals.length > 10) {
    const nums = vals.map(v => parseFloat(v)).filter(v => !isNaN(v));
    if (nums.length / vals.length > 0.95) {
      const sorted = [...nums].sort((a, b) => a - b);
      const diffs  = sorted.slice(1).map((v, i) => v - sorted[i]);
      const allOne = diffs.every(d => d === 1);
      // Extra guard: sequential integers starting from 1 or 0 only
      // Prevents year columns (2000, 2001...) from being flagged
      const startsAtOrigin = sorted[0] === 0 || sorted[0] === 1;
      if (allOne && startsAtOrigin) return true;
    }
  }

  /* ── Step 2a: numeric-but-categorical identifiers (phone, ZIP, account #, coded IDs)
     These are typed "numeric" today and get nonsensical mean/std/outliers. Precision
     over recall: NO purely-numeric signal flags ALONE (R1). Only the combinations in
     R2 flag, except leading-zeros (R4) which is decisive alone. ─────────────────── */

  // Clean raw-string sample (strings — PapaParse dynamicTyping is off, leading zeros survive)
  const raw = vals.map(v => String(v).trim()).filter(v => !isMissing(v));
  if (raw.length === 0) return false;

  // — Signal: integer-form values (keeps leading zeros; rejects decimals like price/temp)
  const intForm    = raw.filter(v => /^-?\d+$/.test(v));
  const allInteger = intForm.length === raw.length;   // ANY decimal → not an integer ID

  // — Signal R4: leading zeros (^0\d+$). Genuine numbers never carry leading zeros →
  //   decisive on its own. Only reachable because the parse path keeps strings.
  const hasLeadingZero = raw.some(v => /^0\d+$/.test(v));

  // — Signal R3: extended name hint at a word boundary. Name ALONE never flags (must
  //   co-occur with a shape signal) — guards "account_balance", "vintage", etc.
  const idNameHint = /(\b|_)(id|uuid|key|index|ref|phone|tel|mobile|fax|zip|zipcode|postal|postcode|ssn|account|acct|ticket|isbn|ean|upc|imei|vin|serial|invoice|plate)(\b|_|$)/i
    .test(nameLower);

  // — Signal: near-perfect uniqueness. A bounded real feature (age, count) can't reach
  //   ~1.0 once N exceeds its range; salaries repeat → stay < 0.99. Guards those.
  const uniqRatio = new Set(raw).size / raw.length;

  // — Signal: constant digit-width ≥ 5. width < 5 excludes year(4)/age(2)/temp; the
  //   modal-width ≥ 90% share requirement excludes mixed-width salary (5–6 figures).
  let constantWidth5 = false;
  let medianWidth    = 0;
  if (intForm.length > 0) {
    const widths = intForm.map(v => v.replace("-", "").length);
    const wFreq  = {};
    widths.forEach(w => { wFreq[w] = (wFreq[w] || 0) + 1; });
    const [modalW, modalCount] = Object.entries(wFreq).sort((a, b) => b[1] - a[1])[0];
    constantWidth5 = Number(modalW) >= 5 && modalCount / widths.length >= 0.9;
    const sortedW  = [...widths].sort((a, b) => a - b);
    medianWidth    = sortedW[Math.floor(sortedW.length / 2)];
  }

  // R4 — leading zeros are decisive alone (verified: dynamicTyping off).
  if (hasLeadingZero) return true;

  // R2·1 — name hint + a corroborating shape signal (constant-width / near-unique).
  if (idNameHint && (constantWidth5 || uniqRatio > 0.99)) return true;

  // R2·2 — near-unique wide integers, but width+uniqueness ALONE is not enough (salary
  //   guard): also require a name hint OR constant width.
  if (uniqRatio > 0.99 && allInteger && medianWidth >= 6 && (idNameHint || constantWidth5)) return true;

  // R2·3 — fixed-width ≥5 integers, only if corroborated by name or leading-zero.
  //   Anonymous 5-digit integers (no name, no leading zero) stay NUMERIC.
  if (constantWidth5 && (idNameHint || hasLeadingZero)) return true;

  return false;
}

/* ── FIX #1 (detectColumnRoles): guard against empty sample (all missing) ── */
/* detectColumnRoles — returns the actual data role for every column.
   The target column gets its true role (numeric/binary/categorical),
   NOT the special "target" sentinel. isTarget is tracked separately
   so getMeta can read the real role without ambiguity. */
/* ── Single-pass min/max ──
   NEVER use Math.min(...vals) / Math.max(...vals) on column data. The spread
   passes every element as a separate call argument and throws
   RangeError: Maximum call stack size exceeded somewhere above ~125k values.
   The upload limit is 40MB, which holds several hundred thousand rows, so that
   was reachable with a perfectly valid file — and the failure landed in a
   setTimeout callback, which no ErrorBoundary can catch, leaving the spinner
   running forever. Caller guards the empty case (min/max are ±Infinity here). */
export function minMax(vals) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

export function buildHistogram(vals, bins = 10) {
  if (!vals.length) return [];
  const { min, max } = minMax(vals);

  if (min === max) {
    return [{ bin: `${min}`, count: vals.length }];
  }

  const binSize    = (max - min) / bins;
  const histogram  = Array.from({ length: bins }, (_, i) => ({
    bin:   `${Math.round((min + i * binSize) * 100) / 100}–${Math.round((min + (i + 1) * binSize) * 100) / 100}`,
    count: 0,
  }));

  vals.forEach(v => {
    const idx = Math.min(Math.floor((v - min) / binSize), bins - 1);
    histogram[idx].count++;
  });

  return histogram;
}
