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
  // Full precision. The 2-decimal rounding that used to live here was a DISPLAY
  // decision baked into a numeric helper, and a p-value computed from a rounded r
  // is wrong by enough to flip a borderline call (measured: p 0.0809 vs scipy's
  // 0.0877 on the same data). Callers round when they render.
  return denom === 0 ? 0 : num / denom;
}

/* ═══════════════════════════════════════════════════════════════════════
   STAGE 7 — statistical depth.

   The engine reported Pearson and called a weak result "no meaningful
   association". Pearson measures LINEAR association only, so on a skewed column
   (titanic Fare, skew 4.79) that sentence could mean "no linear association"
   while a strong monotonic one sat right there. And a correlation carried a
   confidence LABEL derived from the pair count alone — r=0.5 on 8 rows and
   r=0.5 on 891 rows both read "moderate"/"reliable" with no arithmetic behind
   the word.

   Everything below is validated against scipy in tests/phase0.test.mjs.
═══════════════════════════════════════════════════════════════════════ */

/* Lanczos log-gamma — the base for both incomplete functions below. */
const LOG_GAMMA_COF = [
  76.18009172947146, -86.50532032941678, 24.01409824083091,
  -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
];
function logGamma(x) {
  let y   = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += LOG_GAMMA_COF[j] / ++y;
  return -tmp + Math.log(2.5066282746310007 * ser / x);
}

const TINY = 1e-300;   // guards a zero denominator in both continued fractions

/* Regularized lower incomplete gamma P(a,x), by series — converges for x < a+1. */
function gammaSeries(a, x) {
  let ap  = a;
  let sum = 1 / a;
  let del = sum;
  for (let n = 0; n < 300; n++) {
    ap++;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
}

/* Regularized upper incomplete gamma Q(a,x), by continued fraction (x >= a+1). */
function gammaCF(a, x) {
  let b = x + 1 - a;
  let c = 1 / TINY;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 300; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < TINY) d = TINY;
    c = b + an / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

/* Continued fraction for the incomplete beta (Lentz). */
function betaCF(a, b, x) {
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1;
  let d = 1 - qab * x / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 400; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return h;
}

/* Regularized incomplete beta I_x(a,b). */
function betaI(a, b, x) {
  if (!(x > 0)) return 0;
  if (x >= 1)   return 1;
  const bt = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  return x < (a + 1) / (a + b + 2)
    ? bt * betaCF(a, b, x) / a
    : 1 - bt * betaCF(b, a, 1 - x) / b;
}

/* Two-sided p-value for a correlation coefficient r over n paired observations,
   under H0: rho = 0. Matches scipy.stats.pearsonr(...).pvalue (and, on ranks,
   spearmanr's asymptotic p). Returns null when n is too small for the test to
   mean anything — a null p is honest, a fabricated 0.05 is not. */
export function correlationPValue(r, n) {
  if (!Number.isFinite(r) || n < 3) return null;
  const absR = Math.min(1, Math.abs(r));
  if (absR >= 1) return 0;
  const df = n - 2;
  const t2 = (absR * absR) * df / (1 - absR * absR);
  return betaI(df / 2, 0.5, df / (df + t2));
}

/* Upper-tail p-value for a chi-square statistic — scipy.stats.chi2.sf(chi2, df).
   This is what makes a Cramer's V reportable: V says how strong, p says whether
   the table is distinguishable from independence at all. */
export function chiSquarePValue(chi2, df) {
  if (!Number.isFinite(chi2) || df <= 0) return null;
  if (chi2 <= 0) return 1;
  const a = df / 2, x = chi2 / 2;
  return x < a + 1 ? 1 - gammaSeries(a, x) : gammaCF(a, x);
}

/* p-value for a correlation ratio eta over k groups and n observations, via the
   one-way ANOVA F it is equivalent to: F = (eta^2/(k-1)) / ((1-eta^2)/(n-k)).
   Answers "could this separation be chance?", which eta alone cannot. */
export function etaPValue(eta, n, k) {
  if (!Number.isFinite(eta) || k < 2 || n <= k) return null;
  const e2 = Math.min(1, eta * eta);
  if (e2 >= 1) return 0;
  const d1 = k - 1, d2 = n - k;
  const F  = (e2 / d1) / ((1 - e2) / d2);
  return betaI(d2 / 2, d1 / 2, d2 / (d2 + d1 * F));
}

/* Average ranks, ties shared — the transform Spearman is defined on. */
function rankValues(values) {
  const order = values.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
  const ranks = new Array(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const shared = (i + j) / 2 + 1;              // 1-based, averaged over the tie
    for (let k = i; k <= j; k++) ranks[order[k][1]] = shared;
    i = j + 1;
  }
  return ranks;
}

/* Pearson over two aligned arrays. */
function pearsonOf(xs, ys) {
  const n = xs.length;
  if (n < 2) return 0;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? 0 : num / denom;
}

/* Spearman rank correlation — Pearson on average ranks. Monotonic rather than
   linear, so it survives the skew and the outliers that flatten Pearson.
   Returns { rho, n } so the caller can attach a p-value with the same n. */
export function spearmanOf(xs, ys) {
  if (xs.length < 3) return 0;
  return pearsonOf(rankValues(xs), rankValues(ys));
}

export function spearman(data, colA, colB) {
  const xs = [], ys = [];
  for (let i = 0; i < data.length; i++) {
    const a = parseFloat(data[i][colA]);
    const b = parseFloat(data[i][colB]);
    if (isNaN(a) || isNaN(b)) continue;
    xs.push(a); ys.push(b);
  }
  return { rho: spearmanOf(xs, ys), n: xs.length };
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
