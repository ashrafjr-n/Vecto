import {
  getValues, getNumericValues,
  mean, pearson, isNumeric, isMissing, etaCorrelation,
} from "../helpers.js";

export function getRelationshipsV3(data, numericCols, target, skipCols = new Set()) {

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

    const targetUnique  = [...new Set(targetVals.map(v => String(v).toLowerCase().trim()))].sort(byLevel);
    const targetNumeric = targetVals.filter(v => isNumeric(v));
    const isNumericTarget     = targetVals.length > 0 && targetNumeric.length / targetVals.length > 0.8;
    const isBinaryTarget      = targetUnique.length === 2;
    const isCategoricalTarget = !isNumericTarget && targetUnique.length > 2;

    // ── Use all columns for target correlation ──
    // FIX: removed dead targetEncoded block (keyed by object → "[object Object]" bug)
    const allCols = Object.keys(data[0] || {});
    allCols.forEach(col => {
      if (col === target) return;
      // Skip non-feature columns (identifiers ∪ temporals). This loop re-derives types
      // from raw values ignoring roles, so without this an ID or date column leaks back
      // in as a spurious Pearson/Cramér's-V predictor against the target.
      if (skipCols.has(col)) return;

      const colVals = getValues(data, col);
      const colUnique = [...new Set(colVals.map(v => String(v).toLowerCase().trim()))].sort(byLevel);
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
          let a = colIsNumeric ? parseFloat(row[col]) : (colMap ? colMap[String(row[col]).toLowerCase().trim()] : null);
          const bRaw = row[target];
          let b = isNumericTarget
            ? parseFloat(bRaw)
            : (isBinaryTarget ? (targetUnique.indexOf(String(bRaw).toLowerCase().trim()) >= 0 ? targetUnique.indexOf(String(bRaw).toLowerCase().trim()) : null) : null);

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
          const r = denom === 0 ? 0 : Math.round((num / denom) * 100) / 100;
          // FIX #4: store metric type alongside value
          targetCorrelations[col] = { metric: "pearson", value: r, absValue: Math.abs(r) };
        }

      } else if (colIsCategorical) {
        // Cramér's V between categorical col and target
        // Range 0-1, higher = stronger association
        const freqTable = {};
        const rowMarg   = {};
        const colMarg   = {};

        data.forEach(row => {
          const rVal = String(row[col] ?? "").trim();
          const cVal = String(row[target] ?? "").trim();
          if (!rVal || !cVal) return;
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
        // FIX #4: store metric type — Cramér's V is not comparable to Pearson
        targetCorrelations[col] = {
          metric:   "cramers_v",
          value:    Math.round(cramersV * 100) / 100,
          absValue: Math.round(cramersV * 100) / 100,
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
          labels.push(String(rawL).toLowerCase().trim());   // normalize like targetUnique
        });

        if (values.length >= 3) {
          const eta = Math.round(etaCorrelation(values, labels) * 100) / 100;
          targetCorrelations[col] = { metric: "eta", value: eta, absValue: Math.abs(eta) };
        }
      }
    });
  }

  for (let i = 0; i < cols.length; i++) {
    for (let j = i; j < cols.length; j++) {
      const a   = cols[i];
      const b   = cols[j];
      const key = `${a}||${b}`;

      if (i === j) { matrix[key] = 1; continue; }

      // Count usable pairs for confidence
      const pairs = [];
      data.forEach(row => {
        const va = parseFloat(row[a]);
        const vb = parseFloat(row[b]);
        if (!isNaN(va) && !isNaN(vb)) pairs.push([va, vb]);
      });

      const n = pairs.length;
      const r = pearson(data, a, b);
      matrix[key]            = r;
      matrix[`${b}||${a}`]  = r;

      const abs = Math.abs(r);
      if (abs > 0.4) {
        // Strength label
        const strength =
          abs >= 0.9 ? "very strong" :
          abs >= 0.7 ? "strong"      :
          abs >= 0.5 ? "moderate"    : "weak";

        // Confidence based on n pairs
        const confidence =
          n > 100  ? "reliable"  :
          n >= 30  ? "moderate"  : "unreliable";

        // Interpretive statement
        const direction = r > 0 ? "positive" : "negative";
        const trend     = r > 0
          ? `As "${a}" increases, "${b}" tends to increase.`
          : `As "${a}" increases, "${b}" tends to decrease.`;

        strongRelationships.push({
          col1:        a,
          col2:        b,
          correlation: r,
          strength,
          direction,
          confidence,
          nPairs:      n,
          statement:   trend,
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
    observations,
    excludedColumns,
  };
}