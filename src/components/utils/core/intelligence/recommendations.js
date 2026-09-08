import { ROLE } from "../roles.constants.js";

export function getRecommendations({ meta, quality, statistics, relationships, classBalance, visualizations = [] }) {
  const recs = [];

  const push = (rec) => recs.push(rec);

  /* Advice was type-blind: every rule keyed off a quality flag or a statistic
     and never asked what KIND of column it was talking about. meta.columnRoles
     has existed all along and was never consulted here. */
  const roleOf   = col => meta.columnRoles?.[col];
  const catViz   = new Map(visualizations.filter(v => v.type === "categorical").map(v => [v.col, v]));

  /* Imputation depends on what the column IS, not on whether a statistics entry
     happened to exist for it. The old rule read `stat ? (skewed ? median : mean)
     : "mode"` — so the fallback to mode was reached by ACCIDENT, whenever
     statistics had no entry, which is also true for temporal columns (where
     both mean and mode are wrong) and for a numeric column that was excluded
     for any other reason. */
  const imputationFor = (col) => {
    const role = roleOf(col);
    const stat = statistics.find(s => s.col === col);
    if (role === ROLE.TEMPORAL) {
      return { method: "forward-fill or interpolation",
               why: "this is a date column — a mean or a mode date is meaningless; carry the previous value forward or interpolate between neighbours" };
    }
    if (role === ROLE.CATEGORICAL || role === ROLE.BINARY) {
      return { method: 'the most frequent level, or an explicit "Unknown" category',
               why: 'this is a categorical column — averaging levels is undefined, and an explicit "Unknown" keeps missingness visible to the model' };
    }
    if (stat && Math.abs(stat.skewness) > 1) {
      return { method: "median",
               why: `the distribution is skewed (${stat.skewness}), so the mean is pulled toward the tail while the median is not` };
    }
    if (stat) {
      return { method: "mean", why: "the distribution is roughly symmetric, so the mean is a fair centre" };
    }
    return { method: "the most frequent value",
             why: "no numeric summary is available for this column" };
  };

  /* ── Missing values ── */
  quality.columnsWithIssues
    .filter(c => c.issue === "missing")
    .forEach(c => {
      const count  = c.count ?? parseInt(c.detail);   // FIX #3: prefer stored count
      const rawPct = (count / meta.rows) * 100;
      const pct    = rawPct < 1 && rawPct > 0
        ? Math.max(0.1, Math.round(rawPct * 10) / 10)
        : Math.round(rawPct);
      const { method, why } = imputationFor(c.col);

      if (pct > 50) {
        /* "Just drop it" throws away the one thing a mostly-empty column still
           reliably carries: WHETHER the value was present. On titanic, Cabin is
           77% missing and its missingness tracks passenger class closely — the
           presence flag survives even though the value does not. */
        push({
          category:  "Data Cleaning",
          priority:  "high",
          column:    c.col,
          issue:     `Missing values (${pct}%)`,
          action:    `Replace "${c.col}" with a binary "${c.col}_present" indicator rather than dropping it outright, then drop the original.`,
          rationale: `${pct}% missing is past the point where imputing the VALUE is defensible — ${method} would be invented for ${pct}% of rows. Whether the value exists at all is still real, measured information and often correlates with something meaningful, so keep that and discard the rest.`,
        });
      } else if (pct > 20) {
        push({
          category:  "Data Cleaning",
          priority:  "high",
          column:    c.col,
          issue:     `Missing values (${pct}%)`,
          action:    `Impute "${c.col}" with ${method}, and add a binary "${c.col}_was_missing" indicator alongside it.`,
          rationale: `${pct}% missing is high enough that the imputed value becomes a real part of the column — ${why}. The indicator lets the model separate imputed rows from measured ones instead of treating them as equally trustworthy.`,
        });
      } else if (pct > 5) {
        push({
          category:  "Data Cleaning",
          priority:  "medium",
          column:    c.col,
          issue:     `Missing values (${pct}%)`,
          action:    `Impute "${c.col}" with ${method}.`,
          rationale: `${pct}% missing is manageable with standard imputation — ${why}.`,
        });
      } else if (count > 0) {
        push({
          category:  "Data Cleaning",
          priority:  "low",
          column:    c.col,
          issue:     `Missing values (${pct}%)`,
          action:    `Drop the ${count} affected row${count === 1 ? "" : "s"}, or impute "${c.col}" with ${method}.`,
          rationale: `Only ${pct}% of rows are affected, so deleting them costs little${meta.rows > 100 ? "" : " — though with only " + meta.rows + " rows, imputing is safer than losing any"}.`,
        });
      }
    });

  /* ── Duplicate rows ── */
  if (quality.duplicateRows > 0) {
    const dupPct = Math.round((quality.duplicateRows / meta.rows) * 100);
    push({
      category:  "Data Cleaning",
      priority:  dupPct > 5 ? "high" : "medium",
      column:    null,
      issue:     `${quality.duplicateRows} duplicate rows`,
      action:    "Remove duplicate rows before training.",
      rationale: `Duplicate rows inflate training examples and bias model evaluation. ${dupPct}% of dataset is duplicated.`,
    });
  }

  /* ── Constant columns ── */
  quality.columnsWithIssues
    .filter(c => c.issue === "constant")
    .forEach(c => {
      push({
        category:  "Feature Selection",
        priority:  "high",
        column:    c.col,
        issue:     "Constant column (zero variance)",
        action:    `Drop "${c.col}" — all non-missing values are identical.`,
        rationale: "Constant columns carry no information and may cause errors in some ML algorithms.",
      });
    });

  /* ── Identifier columns ── */
  meta.identifierCols.forEach(col => {
    push({
      category:  "Feature Selection",
      priority:  "high",
      column:    col,
      issue:     "Identifier column",
      action:    `Drop "${col}" before training — it appears to be a row identifier.`,
      rationale: "Identifier columns leak row identity into the model, causing overfitting on training data.",
    });
  });

  /* ── Outliers ── */
  statistics
    .filter(s => !s.empty && s.outlierCount > 0)
    .forEach(s => {
      const outlierPct = Math.round((s.outlierCount / s.count) * 100);
      if (outlierPct > 10) {
        push({
          category:  "Data Cleaning",
          priority:  "medium",
          column:    s.col,
          issue:     `${s.outlierCount} outliers (${outlierPct}%)`,
          action:    `Investigate outliers in "${s.col}" before applying any treatment. These may represent valid extreme values rather than errors.`,
          rationale: `${outlierPct}% of values fall outside IQR fences. High outlier rate often reflects natural distribution skew — verify with domain knowledge before removing or capping.`,
        });
      } else if (outlierPct > 2) {
        push({
          category:  "Data Cleaning",
          priority:  "low",
          column:    s.col,
          issue:     `${s.outlierCount} outliers (${outlierPct}%)`,
          action:    `Review outliers in "${s.col}". If confirmed as errors, consider capping at 1st/99th percentile. If valid, leave as-is.`,
          rationale: `${outlierPct}% outlier rate. Always verify whether extreme values are data errors or real observations before treatment.`,
        });
      }
    });

  /* ── Skewed features ── */
  statistics
    .filter(s => !s.empty && Math.abs(s.skewness) > 2)
    .forEach(s => {
      const direction = s.skewness > 0 ? "right" : "left";
      push({
        category:  "Feature Engineering",
        priority:  "low",
        column:    s.col,
        issue:     `High skewness (${s.skewness > 0 ? "+" : ""}${s.skewness})`,
        action:    `Consider log1p transform for "${s.col}" to reduce ${direction}-skew.`,
        rationale: `Skewness of ${s.skewness} is high. Many algorithms assume normally distributed features. Note: only apply if all values are ≥ 0.`,
      });
    });

  /* ── High cardinality categorical ──
     The old rule emitted ONE piece of advice for every high-cardinality column:
     "group rare categories (< 1% frequency) into Other". On titanic's `Name`,
     891 distinct values over 891 rows, EVERY level is below 1% — so following
     that advice merges all 891 into a single bucket and leaves a constant
     column carrying no information at all. The advice destroyed the column it
     was meant to rescue, and quality.js had already labelled the same column
     "likely an ID column" in its own detail string.

     The fix is to ask what the column actually is before advising on it. The
     top level's share is the decisive figure: if the most COMMON level is under
     1%, then by definition every level is, and bucketing cannot do anything but
     collapse the column. */
  quality.columnsWithIssues
    .filter(c => c.issue === "high_cardinality")
    .forEach(c => {
      const viz    = catViz.get(c.col);
      const levels = viz?.uniqueCount ?? null;
      const topPct = viz?.topPct ?? 0;
      const ratio  = levels != null && meta.rows > 0 ? levels / meta.rows : null;

      // Nothing repeats: this is free text, a code, or an identifier — not a
      // category. Bucketing is not merely unhelpful here, it is destructive.
      if (topPct > 0 && topPct < 1) {
        push({
          category:  "Feature Engineering",
          priority:  "medium",
          column:    c.col,
          issue:     `Near-unique values${levels ? ` (${levels} distinct over ${meta.rows} rows)` : ""}`,
          action:    `Do NOT one-hot encode or bucket "${c.col}". Either drop it, or derive features from it — length, word count, or a shared prefix/title extracted from the text.`,
          rationale: `The most frequent value in "${c.col}" appears in only ${topPct}% of rows, so EVERY level is below the 1% threshold. Grouping rare levels into "Other" would merge${levels ? ` all ${levels}` : " every"} of them into one bucket and leave a constant column. A column this unique behaves like an identifier or free text, not a category.`,
        });
        return;
      }

      // Repeating, but with a long tail — grouping is sound here, which is the
      // case the original rule was actually written for.
      push({
        category:  "Feature Engineering",
        priority:  "medium",
        column:    c.col,
        issue:     `High cardinality categorical${levels ? ` (${levels} levels)` : ""}`,
        action:    `Group rare categories in "${c.col}" (< 1% frequency) into "Other", then apply target or frequency encoding rather than one-hot.`,
        rationale: `${levels ? `${levels} levels` : "High cardinality"}${ratio ? ` across ${meta.rows} rows` : ""} creates a sparse one-hot matrix and invites overfitting. The most common level covers ${topPct}% of rows, so grouping the tail still leaves usable categories.`,
      });
    });

  /* ── Class imbalance ── */
  if (classBalance && classBalance.isImbalanced) {
    const majority = classBalance.classes.filter(c => !c.missing)[0];
    const majPct   = majority?.pct ?? 0;
    const severity = majPct > 90 ? "high" : "medium";
    push({
      category:  "Modeling",
      priority:  severity,
      column:    meta.target,
      issue:     `Class imbalance — majority class at ${majPct}%`,
      action:    majPct > 90
        ? `Apply both class weights AND oversampling (e.g. SMOTE) for "${meta.target}" — imbalance is severe.`
        : `Use class-weighted training or oversampling for "${meta.target}" to handle imbalance.`,
      rationale: `A ${majPct}% majority class will cause the model to predict the majority class almost exclusively.`,
    });
  }

  /* ── Multicollinearity ── */
  relationships.multicollinearPairs.forEach(pair => {
    push({
      category:  "Feature Selection",
      priority:  "medium",
      column:    null,
      issue:     `Strongly correlated: "${pair.col1}" ↔ "${pair.col2}" (r = ${pair.correlation.toFixed(2)})`,
      action:    `Consider dropping one of "${pair.col1}" or "${pair.col2}".${
        Object.keys(relationships.targetCorrelations).length > 0
          ? ` Keep the one with higher correlation to target.`
          : ""
      }`,
      rationale: "Near-perfect correlation means both columns carry nearly identical information. Keeping both inflates feature importance and destabilises coefficients.",
    });
  });

  /* ── Target leakage ── */
  relationships.leakageSuspects.forEach(leak => {
    push({
      category:  "Data Integrity",
      priority:  "high",
      column:    leak.col,
      issue:     `Possible target leakage (r = ${leak.correlation.toFixed(2)})`,
      action:    `Investigate "${leak.col}" — it has near-perfect correlation with the target. Verify it is not derived from or computed using the target variable.`,
      rationale: "Target leakage causes models to appear highly accurate during training but fail completely in production.",
    });
  });

  // Sort: high → medium → low
  const ORDER = { high: 0, medium: 1, low: 2 };
  recs.sort((a, b) => (ORDER[a.priority] ?? 3) - (ORDER[b.priority] ?? 3));

  return recs;
}