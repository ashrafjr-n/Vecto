import {
  getValues, getNumericValues,
  mean, isNumeric, isMissing, etaCorrelation, normalizeValue,
  spearmanOf, correlationPValue, chiSquarePValue, etaPValue,
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

  if (target) {
    // Determine target type — guard against empty target column
    const targetVals = getValues(data, target);
    if (!targetVals.length) {
      // No target data — return empty correlation structure
      return { cols: [], correlationMatrix: {}, strongRelationships: [],
               multicollinearPairs: [], clusterDetected: false, clusterCols: [],
               leakageSuspects: [], targetCorrelations: {}, observations: [],
               excludedColumns: [] };
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
      // Skip non-feature columns (identifiers ∪ temporals). This loop re-derives types
      // from raw values ignoring roles, so without this an ID or date column leaks back
      // in as a spurious Pearson/Cramér's-V predictor against the target.
      if (skipCols.has(col)) return;

      const colVals = getValues(data, col);
      const colUnique = [...new Set(colVals.map(normalizeValue))].sort(byLevel);
      const colNumericVals = colVals.filter(v => isNumeric(v));
      const colIsNumeric = colNumericVals.length / colVals.length > 0.8;
      const colIsBinary  = colUnique.length === 2;
      const colIsCategorical = !colIsNumeric && !colIsBinary && colUnique.length > 1;

      if ((colIsNumeric || colIsBinary) && (isNumericTarget || isBinaryTarget)) {
        // Pearson / Point-Biserial: encode col as numbers
        let colMap = null;
        if (colIsBinary && !colIsNumeric) {
          colMap = { [colUnique[0]]: 0, [colUnique[1]]: 1 };
        }

        const pairs = [];
        data.forEach(row => {
          const a = colIsNumeric ? parseFloat(row[col]) : (colMap ? colMap[normalizeValue(row[col])] : null);
          const bRaw = row[target];
          const bIdx = isBinaryTarget ? targetUnique.indexOf(normalizeValue(bRaw)) : -1;
          const b = isNumericTarget ? parseFloat(bRaw) : (bIdx >= 0 ? bIdx : null);

          if (a == null || b == null || isNaN(a) || isNaN(b)) return;
          pairs.push([a, b]);
        });

        if (pairs.length >= 3) {
          const mx = mean(pairs.map(p => p[0]));
          const my = mean(pairs.map(p => p[1]));
          let num = 0, dx2 = 0, dy2 = 0;
          for (const [a, b] of pairs) {
            const dx = a - mx; const dy = b - my;
            num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
          }
          const denom = Math.sqrt(dx2 * dy2);
          const r = denom === 0 ? 0 : num / denom;

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
        }

      } else if (colIsCategorical) {
        // Cramér's V between categorical col and target
        // Range 0-1, higher = stronger association
        const freqTable = {};
        const rowMarg   = {};
        const colMarg   = {};

        data.forEach(row => {
          // Was trim()-only, and skipped only empty strings: "Male" and "male"
          // became two rows of the contingency table (inflating the cardinality the
          // Bergsma correction then penalises), and "NA"/"None" were counted as
          // real categories. Both now follow the engine-wide policy.
          if (isMissing(row[col]) || isMissing(row[target])) return;
          const rVal = normalizeValue(row[col]);
          const cVal = normalizeValue(row[target]);
          const key = `${rVal}|||${cVal}`;
          freqTable[key]  = (freqTable[key]  || 0) + 1;
          rowMarg[rVal]   = (rowMarg[rVal]   || 0) + 1;
          colMarg[cVal]   = (colMarg[cVal]   || 0) + 1;
        });

        const totalN = Object.values(freqTable).reduce((s, v) => s + v, 0);
        if (totalN < 5) return;

        let chi2 = 0;
        Object.entries(freqTable).forEach(([key, obs]) => {
          const [rVal, cVal] = key.split("|||");
          const expected = (rowMarg[rVal] * colMarg[cVal]) / totalN;
          if (expected > 0) chi2 += ((obs - expected) ** 2) / expected;
        });

        const rCats = Object.keys(rowMarg).length;
        const cCats = Object.keys(colMarg).length;
        if (Math.min(rCats - 1, cCats - 1) <= 0) return;

        /* Bergsma (2013) bias correction. Uncorrected V = sqrt(chi2/(N*min(r-1,c-1)))
           rises toward 1.0 from cardinality alone: on Titanic "Name" (891 distinct
           values over 891 rows) scored 0.73 and was reported as the TOP predictor of
           Survived, ahead of "Sex" (0.54) — a column that generalizes to nothing beat
           the real signal. The correction subtracts the chi-square expected under
           independence and shrinks both dimensions the same way, sending per-row-unique
           columns to 0 while leaving Sex/Pclass/Embarked untouched (delta < 0.01 at N=891). */
        const phi2     = chi2 / totalN;
        const phi2Corr = Math.max(0, phi2 - ((rCats - 1) * (cCats - 1)) / (totalN - 1));
        const rTilde   = rCats - ((rCats - 1) ** 2) / (totalN - 1);
        const cTilde   = cCats - ((cCats - 1) ** 2) / (totalN - 1);
        const minDim   = Math.min(rTilde - 1, cTilde - 1);
        // A dimension shrinks to <= 0 exactly when it carried no usable signal (one
        // distinct value per row) — that is a zero association, not a NaN. totalN >= 5
        // is guaranteed above, so the (totalN - 1) divisors are always safe.
        const cramersV = minDim <= 0 ? 0 : Math.sqrt(phi2Corr / minDim);

        /* V says HOW STRONG; the chi-square tail says whether the table is
           distinguishable from independence at all. Without it a small,
           noisy table and a large, decisive one report the same number. */
        const p = chiSquarePValue(chi2, (rCats - 1) * (cCats - 1));

        // FIX #4: store metric type — Cramér's V is not comparable to Pearson
        targetCorrelations[col] = {
          metric:   "cramers_v",
          value:    r2(cramersV),
          absValue: r2(cramersV),
          spearman: null,             // undefined for a nominal pair
          pValue:   p,
          n:        totalN,
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
          const v = parseFloat(rawV);
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
        const va = parseFloat(data[k][a]);
        const vb = parseFloat(data[k][b]);
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

  /* ── Target leakage detection ── */
  const leakageSuspects = Object.entries(targetCorrelations)
    .filter(([, entry]) => {
      const abs = entry?.absValue ?? 0;
      // Only flag Pearson — Cramér's V near 1.0 is less reliable for leakage.
      // FIX #5a: η is intentionally EXCLUDED here too. η≈1.0 can indicate leakage
      // (a numeric feature perfectly separated by target classes), but it also
      // occurs for genuinely strong categorical predictors → high false-positive
      // risk. η-based leakage detection is a DEFERRED decision (not part of 5a).
      return entry?.metric === "pearson" && abs > 0.95;
    })
    .map(([col, entry]) => ({
      col,
      correlation: entry.value,
      warning: `"${col}" has near-perfect correlation with target (r = ${entry.value.toFixed(2)}). Possible target leakage — verify this column is not derived from the target.`,
    }));

  /* ── Categorical <-> categorical associations among features ──
     The correlation matrix covers numericCols only — 4 of titanic's 12 columns —
     so redundancy between two categorical features was undetectable: the engine
     could tell you Age and Fare move together but not that two category columns
     encode the same thing. Same Bergsma-corrected estimator used against the
     target, so the two can be read on one scale. Capped like the numeric scan,
     which is O(k^2) in columns for the same reason. */
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
      // Find the strongest feature
      const strongestCol = Object.entries(targetCorrelations)
        .reduce((best, [col, entry]) => (entry?.absValue ?? 0) > (best[1]?.absValue ?? 0) ? [col, entry] : best, ["", { absValue: 0 }]);
      const scVal = strongestCol[1]?.absValue ?? 0; observations.push(`Weak feature-target associations detected. Strongest: "${strongestCol[0]}" (${scVal.toFixed(2)}). Consider feature engineering.`);
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
  };
}