import {
  getValues, getNumericValues,
  mean, isNumeric, isMissing, etaCorrelation, normalizeValue, toNumber,
  spearmanOf, correlationPValue, etaPValue,
  cramersV, mutualInformation, discretize, sampleIndices, rankColumn, pearsonOf,
} from "../helpers.js";

/* Display rounding lives at the call site now, never inside a numeric helper —
   a p-value computed from an already-rounded r is wrong by enough to flip a
   borderline call. */
const r2 = v => Math.round(v * 100) / 100;

/* A correlation used to carry a confidence LABEL derived from the pair count
   alone, so r=0.5 over 8 rows and r=0.5 over 891 both read "moderate". It is a
   real two-sided p-value now; the three labels are kept so consumers don't
   break, but they finally mean something. */
function confidenceFrom(pValue) {
  if (pValue == null)   return "unreliable";
  if (pValue < 0.001)   return "reliable";
  if (pValue < 0.05)    return "moderate";
  return "unreliable";
}

export function getRelationshipsV3(data, numericCols, target, skipCols = new Set(), categoricalCols = []) {

  /* ── Column selection for the correlation scan (FIX #5b) ──
     The pairwise scan is O(k²·n) in the number of numeric columns k. Below the
     limit we include EVERY numeric column (40² ≈ 1600 pairs — trivial), so no
     column is ever silently dropped. Only above the limit do we cap, and even
     then we (a) rank by a SCALE-FREE criterion and (b) record what was excluded. */
  const CORRELATION_COL_LIMIT = 40;

  let cols;
  let excludedColumns = [];
  if (numericCols.length <= CORRELATION_COL_LIMIT) {
    cols = [...numericCols];                       // all columns, no cap, no slice
  } else {
    // Rank by DISTINCT-COUNT of non-missing values — chosen over coefficient of
    // variation because it is scale-free AND numerically robust: CoV (std/|mean|)
    // blows up when a column is centered near zero, whereas distinct-count never
    // divides. Near-constant columns correctly sink; ties keep original order
    // (Array.sort is stable). Excluded columns are surfaced, never hidden.
    const ranked = numericCols
      .map(col => ({ col, distinct: new Set(getNumericValues(data, col)).size }))
      .sort((a, b) => b.distinct - a.distinct);
    cols            = ranked.slice(0, CORRELATION_COL_LIMIT).map(c => c.col);
    excludedColumns = ranked.slice(CORRELATION_COL_LIMIT).map(c => c.col);
  }

  /* ── Build full correlation matrix ── */
  const matrix             = {};
  const strongRelationships = [];

  // FIX #3: Track target correlations across BOTH numeric and categorical columns.
  // - Numeric target   → Pearson for numeric cols, Point-Biserial approx for binary
  // - Binary target    → Point-Biserial for numeric cols (r = Pearson on 0/1 encoding)
  // - Categorical cols → Cramér's V (chi-square based, range 0-1)
  const targetCorrelations = {};

  /* Columns the target scan could not score, and why.

     Every drop below used to be a bare `return`. The column then appeared in no
     part of the Target Signal report, in no exclusion list, and in no
     observation — it simply was not there, and nothing said so. That is the
     worst outcome of the three, because a wrong number gets argued with and a
     missing one does not get noticed.

     It also hid the single most valuable finding in the report. On smoking.csv,
     "amt_weekends", "amt_weekdays" and "type" are each missing on exactly the
     1,270 rows where smoke = "No": their PRESENCE is a perfect predictor of the
     target. Scoring them on complete rows leaves one target class, so all three
     were dropped — while the report announced "Weak feature-target associations.
     Strongest: age (0.22)". Three perfect predictors, invisible. */
  const unscoredColumns = [];
  const unscored = (col, reason) => unscoredColumns.push({ col, reason });

  /* Columns dropped because the target did not vary on their present rows. Their
     missingness is what carries the information, if anything does — so the reason
     is completed below with the MEASURED verdict rather than a suggestion to go
     and test it. Suggesting a test the engine itself runs two blocks later is how
     a report ends up disagreeing with itself: on events.csv it told the reader to
     try "player_in_present" while the measurement it had already made said that
     indicator scores 0.03. */
  const presenceCandidates = new Set();

  if (target) {
    // Determine target type — guard against empty target column
    const targetVals = getValues(data, target);
    if (!targetVals.length) {
      // No target data — return empty correlation structure
      return { cols: [], correlationMatrix: {}, strongRelationships: [],
               multicollinearPairs: [], clusterDetected: false, clusterCols: [],
               leakageSuspects: [], targetCorrelations: {}, observations: [],
               excludedColumns: [], unscoredColumns: [], presenceSignals: [] };
    }

    /* Deterministic level ordering. [...new Set()] is INSERTION-ordered, so which
       level was encoded 0 and which 1 depended on which row happened to appear
       first in the file: moving a single row to the top flipped the sign of r
       (Titanic: Sex +0.54 -> -0.54, inverting the conclusion drawn from identical
       data). Sorting fixes the convention — numerically when both levels are
       numbers, so "higher value = 1" is meaningful, lexicographically otherwise. */
    const byLevel = (a, b) => (isNumeric(a) && isNumeric(b))
      ? parseFloat(a) - parseFloat(b)
      : (a < b ? -1 : a > b ? 1 : 0);

    const targetUnique  = [...new Set(targetVals.map(normalizeValue))].sort(byLevel);
    const targetNumeric = targetVals.filter(v => isNumeric(v));
    const isNumericTarget     = targetVals.length > 0 && targetNumeric.length / targetVals.length > 0.8;
    const isBinaryTarget      = targetUnique.length === 2;
    const isCategoricalTarget = !isNumericTarget && targetUnique.length > 2;

    // ── Use all columns for target correlation ──
    // FIX: removed dead targetEncoded block (keyed by object → "[object Object]" bug)
    /* Mutual information is the fallback detector: it is the only measure here
       that sees a relationship which is real but NOT monotonic (U-shaped,
       threshold, periodic), where Pearson AND Spearman both report ~0. It is
       computed only when both correlations came back weak — when they are
       strong the signal is already found, and MI costs a sort per column. */
    const miIdx        = sampleIndices(data.length);
    const targetLevels = discretize(miIdx.map(k => data[k][target]));

    const allCols = Object.keys(data[0] || {});
    allCols.forEach(col => {
      if (col === target) return;
      /* Skip non-feature columns (identifiers ∪ temporals ∪ free text). This loop
         re-derives types from raw values ignoring roles, so without this an ID, a
         date or a commentary field leaks back in as a spurious predictor.

         Recorded rather than dropped: these were leaving the report with no trace
         at all, the same silence unscoredColumns was built to end. ginf.csv's
         "id_odsp" and "date" simply were not in the Target Signal tab, and a
         reader had no way to tell a skipped column from an absent one.
         `skipCols` is a Map from index.js; the ?. covers a plain Set caller. */
      if (skipCols.has(col)) {
        unscored(col, skipCols.get?.(col) ?? `"${col}" is not a feature column and was left out of the scan.`);
        return;
      }

      /* One pass, three allocations fewer. This was getValues() (an array of n),
         .map(normalizeValue) (a second array of n) and .filter(isNumeric) (a
         third), per column — 48 full-length arrays on a 386k-row, 16-column file,
         to answer two questions: what share of the values are numbers, and are
         there exactly two levels.

         The level set stops at 3. No rule below distinguishes 5 levels from 500,
         only "two" from "more than two", so the Set is O(1) rather than one entry
         per distinct value. getValues()' own filter is inlined verbatim — it
         keeps "NA" as a level, unlike isMissing, and that must not change here. */
      let colTotal = 0, colNumericCount = 0, colOverflowed = false;
      const colLevels = new Set();
      for (let i = 0; i < data.length; i++) {
        const v = data[i][col];
        if (v === "" || v == null) continue;
        colTotal++;
        if (isNumeric(v)) colNumericCount++;
        if (!colOverflowed) {
          colLevels.add(normalizeValue(v));
          if (colLevels.size > 2) colOverflowed = true;
        }
      }
      if (colTotal === 0) {
        unscored(col, `"${col}" is empty — there is nothing to compare against "${target}".`);
        return;
      }

      const colUnique = [...colLevels].sort(byLevel);
      const colIsNumeric = colNumericCount / colTotal > 0.8;
      const colIsBinary  = !colOverflowed && colLevels.size === 2;
      const colIsCategorical = !colIsNumeric && !colIsBinary && (colOverflowed || colLevels.size > 1);

      if ((colIsNumeric || colIsBinary) && (isNumericTarget || isBinaryTarget)) {
        // Pearson / Point-Biserial: encode col as numbers
        let colMap = null;
        if (colIsBinary && !colIsNumeric) {
          colMap = { [colUnique[0]]: 0, [colUnique[1]]: 1 };
        }

        const pairs = [];
        data.forEach(row => {
          const a = colIsNumeric ? toNumber(row[col]) : (colMap ? colMap[normalizeValue(row[col])] : null);
          const bRaw = row[target];
          const bIdx = isBinaryTarget ? targetUnique.indexOf(normalizeValue(bRaw)) : -1;
          const b = isNumericTarget ? toNumber(bRaw) : (bIdx >= 0 ? bIdx : null);

          if (a == null || b == null || isNaN(a) || isNaN(b)) return;
          pairs.push([a, b]);
        });

        if (pairs.length < 3) {
          unscored(col, `only ${pairs.length} row${pairs.length === 1 ? "" : "s"} have both a numeric "${col}" and a usable "${target}" — too few to correlate.`);
          return;
        }

        const mx = mean(pairs.map(p => p[0]));
        const my = mean(pairs.map(p => p[1]));
        let num = 0, dx2 = 0, dy2 = 0;
        for (const [a, b] of pairs) {
          const dx = a - mx; const dy = b - my;
          num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
        }

        /* Zero variance on either side is not a correlation of zero — it is the
           absence of anything to correlate. Reporting r = 0 here said "measured,
           and there is no relationship" about a pair that was never measurable,
           and it did so for exactly the case worth knowing about: a column whose
           missing rows are the target's other class, so the surviving rows all
           carry one target value. */
        if (dy2 === 0) {
          presenceCandidates.add(col);
          unscored(col, `"${target}" holds a single value across all ${pairs.length} rows where "${col}" is a number, so there is nothing varying to correlate against.`);
          return;
        }
        if (dx2 === 0) {
          unscored(col, `"${col}" is constant across the rows shared with "${target}" — a constant carries no signal.`);
          return;
        }

        const denom = Math.sqrt(dx2 * dy2);
        const r = num / denom;

        /* Pearson answers "is it LINEAR?". On a skewed column that is the wrong
           question, and answering it alone let the engine report "no meaningful
           association" when it meant "no linear association" — titanic Fare has
           skew 4.79. Spearman is computed on the same pairs and reported beside
           it; where the two disagree, the disagreement is the finding. */
        const rho = spearmanOf(pairs.map(q => q[0]), pairs.map(q => q[1]));
        const p   = correlationPValue(r, pairs.length);

        // FIX #4: store metric type alongside value
        const weak = Math.abs(r) < 0.3 && Math.abs(rho) < 0.3;
        const mi   = weak
          ? mutualInformation(discretize(miIdx.map(k => data[k][col])), targetLevels)
          : null;

        targetCorrelations[col] = {
          metric:   "pearson",
          value:    r2(r),
          absValue: Math.abs(r2(r)),
          spearman: r2(rho),
          pValue:   p,
          n:        pairs.length,
          // Non-null only where both correlations were weak — see above.
          mi:       mi ? r2(mi.normalized) : null,
        };

      } else if (colIsCategorical) {
        /* Cramer's V between a categorical column and the target, via the SHARED
           estimator. This branch used to carry its own copy of the whole
           calculation — contingency table, chi-square, Bergsma correction — which
           is how the two drifted: the fix for empty contingency cells landed in
           helpers.cramersV and left the copy here reporting the old, understated
           number. One implementation cannot disagree with itself. */
        const la = [], lb = [];
        for (let i = 0; i < data.length; i++) {
          const row = data[i];
          if (isMissing(row[col]) || isMissing(row[target])) continue;
          la.push(normalizeValue(row[col]));
          lb.push(normalizeValue(row[target]));
        }

        /* null = too few rows, or only one level left on a side. No association is
           measurable there, which is not the same as an association of zero — so
           the column is recorded with the reason rather than dropped. The
           diagnosis costs two Sets and runs only on the cold path. */
        const cv = cramersV(la, lb);
        if (!cv) {
          const targetLevelsLeft = new Set(lb).size;
          if (la.length < 5) {
            unscored(col, `only ${la.length} row${la.length === 1 ? "" : "s"} have both this column and "${target}" — too few to measure against.`);
          } else if (targetLevelsLeft < 2) {
            presenceCandidates.add(col);
            unscored(col, `every row where "${col}" is present has the same "${target}" value, so there is nothing varying to correlate against.`);
          } else {
            unscored(col, `"${col}" has a single value on the rows where "${target}" is also present — a constant cannot be correlated.`);
          }
          return;
        }

        // FIX #4: store metric type — Cramér's V is not comparable to Pearson
        targetCorrelations[col] = {
          metric:   "cramers_v",
          value:    r2(cv.v),
          absValue: r2(cv.v),
          spearman: null,             // undefined for a nominal pair
          /* V says HOW STRONG; the chi-square tail says whether the table is
             distinguishable from independence at all. Without it a small, noisy
             table and a large, decisive one report the same number. */
          pValue:   cv.pValue,
          n:        cv.n,
        };

      } else if (colIsNumeric && isCategoricalTarget) {
        // FIX #5a: numeric feature vs categorical (>2-class) target — correlation
        // ratio η. Previously this pairing fell through BOTH branches above and
        // contributed no signal, flooring signalScore. η is on the same 0-1 scale
        // as Pearson |r| / Cramér's V, so it drops straight into maxTargetR.
        const values = [];
        const labels = [];
        data.forEach(row => {
          const rawV = row[col];
          const rawL = row[target];
          if (isMissing(rawV) || isMissing(rawL)) return;   // exclude missing on both sides
          const v = toNumber(rawV);
          if (isNaN(v)) return;
          values.push(v);
          labels.push(normalizeValue(rawL));                // same key as targetUnique
        });

        if (values.length >= 3) {
          const eta = etaCorrelation(values, labels);
          const k   = new Set(labels).size;
          targetCorrelations[col] = {
            metric:   "eta",
            value:    r2(eta),
            absValue: Math.abs(r2(eta)),
            spearman: null,           // undefined against a nominal target
            pValue:   etaPValue(eta, values.length, k),
            n:        values.length,
          };
        }
      }
    });
  }

  /* Ranks are computed ONCE PER COLUMN, not once per pair. Ranking inside the
     pair loop costs a sort per pair — O(k^2 · n log n) — which at the 40-column
     limit and 800k rows is minutes, not seconds. This is k sorts total and
     leaves the pair loop O(n), the order it already was.

     Trade-off, stated rather than hidden: when two columns are missing on
     DIFFERENT rows, these ranks come from each column's own non-missing set
     instead of being re-ranked inside the pair's common subset, so rho can
     differ slightly from scipy's pairwise spearmanr. The per-feature Spearman
     that actually gets reported against the target is computed exactly on the
     pair, above. */
  const columnRanks = new Map(cols.map(c => [c, rankColumn(data, c)]));

  for (let i = 0; i < cols.length; i++) {
    for (let j = i; j < cols.length; j++) {
      const a   = cols[i];
      const b   = cols[j];
      const key = `${a}||${b}`;

      if (i === j) { matrix[key] = 1; continue; }

      // One pass collects the value pairs AND the rank pairs (pairwise-complete).
      const ra = columnRanks.get(a), rb = columnRanks.get(b);
      const xs = [], ys = [], rxs = [], rys = [];
      for (let k = 0; k < data.length; k++) {
        const va = toNumber(data[k][a]);
        const vb = toNumber(data[k][b]);
        if (isNaN(va) || isNaN(vb)) continue;
        xs.push(va); ys.push(vb); rxs.push(ra[k]); rys.push(rb[k]);
      }

      const n   = xs.length;
      const raw = n < 3 ? 0 : pearsonOf(xs, ys);   // full precision since stage 7
      const r   = r2(raw);                         // matrix is a display surface
      const rho = n < 3 ? 0 : pearsonOf(rxs, rys); // Pearson on ranks = Spearman
      const p   = correlationPValue(raw, n);
      matrix[key]            = r;
      matrix[`${b}||${a}`]  = r;

      /* A pair can be strongly MONOTONIC while barely linear — an exponential or
         heavily skewed pair is the usual case. Reporting only Pearson hid those
         entirely, so the scan considers whichever of the two is larger. */
      const abs = Math.max(Math.abs(r), Math.abs(rho));
      if (abs > 0.4) {
        // Strength label
        const strength =
          abs >= 0.9 ? "very strong" :
          abs >= 0.7 ? "strong"      :
          abs >= 0.5 ? "moderate"    : "weak";


        // Confidence is now the actual two-sided p-value, not a bucket on n.
        const confidence = confidenceFrom(p);

        // Interpretive statement. Direction follows whichever coefficient is
        // carrying the relationship, so a monotonic-only pair is not described
        // by the sign of a near-zero Pearson.
        const lead      = Math.abs(rho) > Math.abs(r) ? rho : r;
        const direction = lead > 0 ? "positive" : "negative";
        const trend     = lead > 0
          ? `As "${a}" increases, "${b}" tends to increase.`
          : `As "${a}" increases, "${b}" tends to decrease.`;

        /* The gap between the two coefficients is itself the finding: a large
           Spearman with a small Pearson means the relationship is real but not
           a straight line, and a linear model will underfit it. */
        const monotonicNotLinear = Math.abs(rho) - Math.abs(r) > 0.15;

        strongRelationships.push({
          col1:        a,
          col2:        b,
          correlation: r,
          spearman:    r2(rho),
          pValue:      p,
          strength,
          direction,
          confidence,
          monotonicNotLinear,
          nPairs:      n,
          statement:   monotonicNotLinear
            ? `${trend} The relationship is monotonic but not linear (Spearman ${r2(rho).toFixed(2)} vs Pearson ${r.toFixed(2)}) — a straight-line model will underfit it.`
            : trend,
        });
      }
    }
  }

  strongRelationships.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));

  /* ── Correlated-pair detection (|r| ≥ 0.9) ──
     NOTE: multicollinearPairs is pairwise |r| ≥ 0.9, NOT VIF-based multicollinearity.
     The field name is kept for consumer stability; user-facing labels say "strongly correlated". */
  const multicollinearPairs = strongRelationships
    .filter(r => Math.abs(r.correlation) >= 0.9)
    .map(r => ({
      col1:        r.col1,
      col2:        r.col2,
      correlation: r.correlation,
      warning:     `"${r.col1}" and "${r.col2}" are nearly identical (r = ${r.correlation.toFixed(2)}). Consider dropping one.`,
    }));

  /* ── Feature cluster detection ── */
  // For each col, count how many others have |r| > 0.7
  const clusterMap = {};
  cols.forEach(col => {
    clusterMap[col] = cols.filter(other => {
      if (other === col) return false;
      const key = `${col}||${other}`;
      const rev = `${other}||${col}`;
      const r   = matrix[key] ?? matrix[rev] ?? 0;
      return Math.abs(r) >= 0.7;
    });
  });

  // A cluster = 3+ columns mutually correlated
  const clusterCols = cols.filter(c => clusterMap[c].length >= 2);
  const clusterDetected = clusterCols.length >= 3;
  const clusterObservation = clusterDetected
    ? `Feature cluster detected: ${clusterCols.join(", ")} are heavily intercorrelated. Consider dimensionality reduction within this group.`
    : null;

  /* ── Target leakage detection ──────────────────────────────────────────────
     Was Pearson-only, on the grounds that "Cramér's V near 1.0 is less reliable
     for leakage" — which was true of the V this engine used to compute. An
     uncorrected V climbed toward 1.0 on cardinality alone, so a near-1.0 score
     said more about the number of levels than about the relationship. Two fixes
     have since removed exactly that: the Bergsma correction sends per-row-unique
     columns to 0, and counting the empty contingency cells stopped understating
     the sparse tables where a deterministic mapping actually lives. V = 1.0 now
     means a functional dependency, which is what leakage IS.

     Measured on the audit files: meets.csv "MeetCountry" against "MeetState"
     scores 0.99 — a state determines its country, so the feature restates the
     label. It went unflagged before, and 0.94 under the old chi-square.

     η stays excluded, with its original reasoning intact: η ≈ 1.0 also occurs
     for genuinely strong categorical predictors, and nothing has changed that.

     Both thresholds are 0.95 on purpose — after the corrections above the two
     metrics mean the same thing at the top of their range: near-determinism. */
  const LEAKAGE_MIN = 0.95;

  const leakageSuspects = Object.entries(targetCorrelations)
    .filter(([, e]) => (e?.metric === "pearson" || e?.metric === "cramers_v")
                    && (e?.absValue ?? 0) >= LEAKAGE_MIN)
    .map(([col, entry]) => ({
      col,
      correlation: entry.value,
      metric: entry.metric,
      warning: entry.metric === "pearson"
        ? `"${col}" has near-perfect correlation with target (r = ${entry.value.toFixed(2)}, n = ${entry.n}). Possible target leakage — verify this column is not derived from the target.`
        : `"${col}" almost completely determines "${target}" (Cramér's V ${entry.value.toFixed(2)}, n = ${entry.n}) — knowing one gives you the other. Possible target leakage: verify this column is not the label under another name.`,
    }));

  /* ── Categorical <-> categorical associations among features ──
     The correlation matrix covers numericCols only — 4 of titanic's 12 columns —
     so redundancy between two categorical features was undetectable: the engine
     could tell you Age and Fare move together but not that two category columns
     encode the same thing. Same Bergsma-corrected estimator used against the
     target, so the two can be read on one scale. Capped like the numeric scan,
     which is O(k^2) in columns for the same reason. */
  /* Both sides of a presence indicator need enough rows to mean anything, and a
     weak presence association is noise — every column with a single missing row
     would otherwise produce an entry. */
  /* Below this share of the dataset a coefficient describes a slice, not the file,
     and saying so is the difference between a number and a claim. */
  const COVERAGE_MIN = 0.5;

  const MIN_PRESENCE_ROWS = 20;
  const PRESENCE_MIN_V    = 0.3;

  const CATEGORICAL_PAIR_LIMIT = 25;
  const catCols = categoricalCols.filter(c => c !== target && !skipCols.has(c))
                                 .slice(0, CATEGORICAL_PAIR_LIMIT);
  const catLevels = new Map(catCols.map(c => [c, data.map(r => r[c]).map(normalizeValue)]));

  const categoricalAssociations = [];
  for (let i = 0; i < catCols.length; i++) {
    for (let j = i + 1; j < catCols.length; j++) {
      const a = catCols[i], b = catCols[j];
      const la = catLevels.get(a), lb = catLevels.get(b);
      const va = [], vb = [];
      for (let k = 0; k < data.length; k++) {
        if (isMissing(data[k][a]) || isMissing(data[k][b])) continue;
        va.push(la[k]); vb.push(lb[k]);
      }
      if (va.length < 5) continue;
      const res = cramersV(va, vb);
      if (!res || res.v < 0.3) continue;
      categoricalAssociations.push({
        col1: a, col2: b,
        cramersV: r2(res.v),
        pValue:   res.pValue,
        nPairs:   res.n,
        levels:   res.levels,
        statement: `"${a}" and "${b}" are associated (Cramér's V ${r2(res.v).toFixed(2)}) — they may encode overlapping information.`,
      });
    }
  }
  categoricalAssociations.sort((x, y) => y.cramersV - x.cramersV);

  /* ── Does the PRESENCE of a value predict the target? ─────────────────────
     For a column with missing rows, "was this recorded at all" is a second,
     separate variable, and it is often the one that carries the signal: the
     value is missing BECAUSE of what the row is. The engine already advised
     building a "<col>_present" indicator for mostly-empty columns, and told the
     user it "often correlates with something meaningful" — without ever
     computing it, though the answer is one contingency table away.

     On smoking.csv the answer is total: "amt_weekends", "amt_weekdays" and
     "type" are missing on exactly the 1,270 rows where smoke = "No", so the
     indicator alone separates the classes perfectly (V = 1.00) while the report
     called the dataset's strongest association 0.22.

     Only the indicator is measured here, never the value — a column can be
     unmeasurable on its complete rows (that is what unscoredColumns records) and
     still be decisive through its presence. */
  const presenceSignals = [];
  const presenceMeasured = new Map();   // every column the indicator could be measured on
  if (target) {
    const targetKeys = data.map(r => (isMissing(r[target]) ? null : normalizeValue(r[target])));

    for (const col of Object.keys(data[0] || {})) {
      if (col === target || skipCols.has(col)) continue;

      /* Count first, allocate second. Both sides of the indicator must exist or
         there is no indicator at all, and most columns in a real file have no
         missing rows — so the common case exits after one scalar pass instead of
         building two arrays per column the length of the dataset. */
      let present = 0, absent = 0;
      for (let i = 0; i < data.length; i++) {
        if (targetKeys[i] === null) continue;
        if (isMissing(data[i][col])) absent++; else present++;
      }
      if (present < MIN_PRESENCE_ROWS || absent < MIN_PRESENCE_ROWS) continue;

      const flags = [], keys = [];
      for (let i = 0; i < data.length; i++) {
        if (targetKeys[i] === null) continue;
        flags.push(isMissing(data[i][col]) ? "absent" : "present");
        keys.push(targetKeys[i]);
      }

      const cv = cramersV(flags, keys);
      if (!cv) continue;
      presenceMeasured.set(col, r2(cv.v));
      if (cv.v < PRESENCE_MIN_V) continue;

      presenceSignals.push({
        col,
        cramersV:   r2(cv.v),
        pValue:     cv.pValue,
        n:          cv.n,
        presentPct: r2((present / (present + absent)) * 100),
        statement:  `Whether "${col}" was recorded at all is associated with "${target}" `
                  + `(Cramér's V ${r2(cv.v).toFixed(2)}, n = ${cv.n}) — a "${col}_present" indicator `
                  + `carries signal the column's values alone do not.`,
      });
    }
    presenceSignals.sort((a, b) => b.cramersV - a.cramersV);
  }

  /* A presence indicator that separates the target almost perfectly is leakage of
     the same kind, arriving by a different route: the column is not filled in for
     one class of row, so "was this recorded" restates the label. It cannot come
     from the loop above because these columns are precisely the ones the target
     scan could not score — smoking.csv's "type" has no targetCorrelations entry
     at all, and openpowerlifting's "TotalKg" presence decides "Place" (no total
     recorded, no placing). Appended here because presenceSignals is computed
     after the leakage scan. */
  for (const p of presenceSignals) {
    if (p.cramersV < LEAKAGE_MIN) continue;
    leakageSuspects.push({
      col: p.col,
      correlation: p.cramersV,
      metric: "presence",
      warning: `Whether "${p.col}" was recorded at all almost completely determines "${target}" `
             + `(Cramér's V ${p.cramersV.toFixed(2)}, n = ${p.n}) — the column is filled in for one class and empty for the other. `
             + `Possible target leakage: verify the missingness is not a consequence of the label rather than a predictor of it.`,
    });
  }

  /* Finish the reason for every column dropped for a constant target: the
     indicator either carries the signal or it does not, and both answers are
     already computed above. */
  for (const entry of unscoredColumns) {
    if (!presenceCandidates.has(entry.col)) continue;
    const v = presenceMeasured.get(entry.col);
    if (v === undefined) {
      entry.reason += ` Its presence could not be tested either — one side of the indicator has too few rows.`;
    } else if (v >= PRESENCE_MIN_V) {
      entry.reason += ` What DOES carry signal is whether the value was recorded at all: that indicator alone `
                    + `is associated with "${target}" at Cramér's V ${v.toFixed(2)}. Build "${entry.col}_present".`;
    } else {
      entry.reason += ` Whether the value was recorded at all was tested too, and scores only Cramér's V `
                    + `${v.toFixed(2)} against "${target}" — the missingness carries no usable signal here either.`;
    }
  }

  /* ── Dataset-level observations ── */
  const observations = [];

  if (multicollinearPairs.length > 0) {
    observations.push(`${multicollinearPairs.length} pair${multicollinearPairs.length > 1 ? "s" : ""} of features are strongly correlated (|r| ≥ 0.9) — redundancy risk.`);
  }

  if (leakageSuspects.length > 0) {
    observations.push(`${leakageSuspects.length} feature${leakageSuspects.length > 1 ? "s" : ""} may contain target information — check for data leakage.`);
  }

  // FIX P1: read absValue directly, never Math.abs(entry object)
  const maxTargetR = Object.values(targetCorrelations).reduce((m, entry) => Math.max(m, entry.absValue ?? 0), 0);
  if (target && Object.keys(targetCorrelations).length > 0) {
    if (maxTargetR < 0.1) {
      observations.push(`No feature shows meaningful association with target (max = ${maxTargetR.toFixed(2)}). Consider feature engineering or non-linear models.`);
    } else if (maxTargetR >= 0.1 && maxTargetR < 0.3) {
      const strongestCol = Object.entries(targetCorrelations)
        .reduce((best, [col, entry]) => (entry?.absValue ?? 0) > (best[1]?.absValue ?? 0) ? [col, entry] : best, ["", { absValue: 0 }]);
      const scVal = strongestCol[1]?.absValue ?? 0;

      /* A coefficient is a claim about the rows it was computed on, and naming the
         top one without saying how many rows that was makes a narrow measurement
         sound like a property of the dataset. openpowerlifting.csv reported
         "Strongest: Squat4Kg (0.16)" — a fourth-attempt column present on 1,225 of
         386,414 rows, 0.3%, while Equipment scored 0.14 across 99.7% of them. The
         value of n was in the payload all along; nothing said it out loud. */
      const coverage = (entry) => (data.length > 0 ? (entry?.n ?? 0) / data.length : 0);
      const topCoverage = coverage(strongestCol[1]);

      let line = `Weak feature-target associations detected. Strongest: "${strongestCol[0]}" (${scVal.toFixed(2)}`;
      if (topCoverage < COVERAGE_MIN) {
        line += `, but measured on only ${strongestCol[1].n} of ${data.length} rows — ${(topCoverage * 100).toFixed(1)}% of the dataset`;

        /* Name the best broadly-measured feature beside it, so the reader has
           something to compare the narrow number against. */
        const broad = Object.entries(targetCorrelations)
          .filter(([, e]) => coverage(e) >= COVERAGE_MIN)
          .reduce((best, [col, e]) => (e.absValue ?? 0) > (best[1]?.absValue ?? 0) ? [col, e] : best, ["", { absValue: 0 }]);
        if (broad[0]) {
          line += `). Across most of the data the strongest is "${broad[0]}" (${(broad[1].absValue ?? 0).toFixed(2)} over ${broad[1].n} rows`;
        }
      }
      observations.push(`${line}). Consider feature engineering.`);
    }
  }

  const nonLinear = strongRelationships.filter(sr => sr.monotonicNotLinear);
  if (nonLinear.length > 0) {
    const names = nonLinear.slice(0, 3).map(sr => `"${sr.col1}"~"${sr.col2}"`).join(", ");
    observations.push(
      `${nonLinear.length} relationship${nonLinear.length > 1 ? "s are" : " is"} monotonic but not linear ` +
      `(${names}${nonLinear.length > 3 ? ", …" : ""}) — Pearson understates ${nonLinear.length > 1 ? "them" : "it"}; ` +
      `consider a rank-based or non-linear model.`
    );
  }

  /* The case that exists only because MI is here: a feature the correlations
     both call noise, which nonetheless carries information about the target. */
  const nonMonotonic = Object.entries(targetCorrelations)
    .filter(([, e]) => (e.mi ?? 0) >= 0.15 && (e.absValue ?? 0) < 0.15);
  if (nonMonotonic.length > 0) {
    const names = nonMonotonic.slice(0, 3).map(([c]) => `"${c}"`).join(", ");
    observations.push(
      `${names} show${nonMonotonic.length === 1 ? "s" : ""} little linear or monotonic correlation with the target ` +
      `but still carr${nonMonotonic.length === 1 ? "ies" : "y"} information about it (mutual information ` +
      `${nonMonotonic.slice(0, 3).map(([, e]) => e.mi.toFixed(2)).join(", ")}) — the relationship is real but not monotonic, ` +
      `so a linear model will miss it.`
    );
  }

  /* Named BEFORE the "weak signal" verdict below, because it qualifies it: a
     report cannot honestly call the strongest association 0.22 while three
     columns it could not measure sit unmentioned. */
  if (unscoredColumns.length > 0) {
    const shown = unscoredColumns.slice(0, 3).map(u => `"${u.col}"`).join(", ");
    const more  = unscoredColumns.length > 3 ? `, +${unscoredColumns.length - 3} more` : "";
    observations.unshift(
      `${unscoredColumns.length} column${unscoredColumns.length > 1 ? "s were" : " was"} left out of the target scan ` +
      `(${shown}${more}) — ${unscoredColumns.length > 1 ? "they were" : "it was"} not measured, which is not the same as ` +
      `showing no signal. See the reason on each.`
    );
  }

  /* Ahead of the "weak signal" verdict, and unshifted AFTER the unscored
     list so it lands above it — it is the ANSWER to the question that list raises. */
  if (presenceSignals.length > 0) {
    const top = presenceSignals[0];
    observations.unshift(
      `Whether "${top.col}" was recorded at all is associated with "${target}" (Cramér's V ${top.cramersV.toFixed(2)}` +
      `${presenceSignals.length > 1 ? `, and ${presenceSignals.length - 1} other column${presenceSignals.length > 2 ? "s" : ""} likewise` : ""}) — ` +
      `the missingness carries signal, so build "${top.col}_present" rather than dropping the column.`
    );
  }

  if (categoricalAssociations.length > 0) {
    observations.push(
      `${categoricalAssociations.length} categorical feature pair${categoricalAssociations.length > 1 ? "s are" : " is"} ` +
      `associated (strongest: "${categoricalAssociations[0].col1}"~"${categoricalAssociations[0].col2}", ` +
      `V=${categoricalAssociations[0].cramersV.toFixed(2)}) — possible redundancy.`
    );
  }

  if (clusterObservation) observations.push(clusterObservation);

  // FIX #5b: never drop columns silently — name what was excluded when capped.
  if (excludedColumns.length > 0) {
    const shown = excludedColumns.slice(0, 8).join(", ");
    const more  = excludedColumns.length > 8 ? `, +${excludedColumns.length - 8} more` : "";
    observations.push(
      `${numericCols.length} numeric columns exceeded the correlation limit (${CORRELATION_COL_LIMIT}); ` +
      `showing the top ${CORRELATION_COL_LIMIT} by distinct-value count. Excluded: ${shown}${more}.`
    );
  }

  return {
    cols,
    correlationMatrix:    matrix,
    strongRelationships,
    multicollinearPairs,
    clusterDetected,
    clusterCols,
    leakageSuspects,
    targetCorrelations,
    categoricalAssociations,
    observations,
    excludedColumns,
    unscoredColumns,
    presenceSignals,
  };
}