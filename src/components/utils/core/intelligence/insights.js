export function getPriorityInsights({ meta, quality, statistics, relationships, classBalance }) {
  const insights = [];

  const push = (severity, title, text, score) => {
    insights.push({ severity, title, text, priorityScore: score });
  };

  // Trainability flavor for the smallest class — gated on ABSOLUTE count, not the
  // imbalance %, so a moderate skew with plenty of minority samples raises no alarm.
  // Shared by both imbalance insights (#3 severe, #7 moderate) to keep them in sync.
  const minorityFlavor = count =>
    count < 10 ? " — critically few, likely too few to learn a reliable pattern"
    : count < 50 ? " — may be too few for reliable learning"
    : "";

  /* ── CRITICAL ── */

  // Target leakage
  relationships.leakageSuspects.forEach(leak => {
    push("critical",
      "Possible Target Leakage",
      /* The warning is composed where the metric is known. Re-writing it here
         printed "r = 0.99" for a Cramér's V, which is a different statistic. */
      leak.warning,
      100
    );
  });

  // Massive missing on a column (> 50%)
  quality.columnsWithIssues
    .filter(c => c.issue === "missing")
    .forEach(c => {
      const rawP2 = ((c.count ?? parseInt(c.detail)) / meta.rows) * 100;
      const pct   = rawP2 < 1 && rawP2 > 0
        ? Math.max(0.1, Math.round(rawP2 * 10) / 10)
        : Math.round(rawP2);
      if (pct > 50) {
        push("critical",
          `Critical Missing Values in "${c.col}"`,
          `${pct}% of values in "${c.col}" are missing. This column may not be usable.`,
          98
        );
      }
    });

  // Severe class imbalance
  if (classBalance?.isImbalanced) {
    const nonMissing = classBalance.classes.filter(c => !c.missing);
    const majority   = nonMissing[0];
    const minority   = nonMissing[nonMissing.length - 1];   // smallest class = binding constraint
    const majPct     = majority?.pct ?? 0;
    if (majPct > 90) {
      push("critical",
        "Severe Class Imbalance",
        `Target class "${majority.value}" dominates at ${majPct}%. Model will likely predict only the majority class.` +
        ` The smallest class "${minority.value}" has only ${minority.count} sample(s)${minorityFlavor(minority.count)}.`,
        95
      );
    }
  }

  /* ── WARNING ── */

  // Duplicate rows
  if (quality.duplicateRows > 0) {
    push("warning",
      "Duplicate Rows Detected",
      `${quality.duplicateRows} duplicate row${quality.duplicateRows > 1 ? "s" : ""} found. Remove before training to avoid biased evaluation.`,
      80
    );
  }

  // Significant missing values (5-50%)
  quality.columnsWithIssues
    .filter(c => c.issue === "missing")
    .forEach(c => {
      const pct = Math.round(((c.count ?? parseInt(c.detail)) / meta.rows) * 100);
      if (pct > 5 && pct <= 50) {
        push("warning",
          `Missing Values in "${c.col}"`,
          `${pct}% of values in "${c.col}" are missing — imputation recommended.`,
          70 + pct * 0.3
        );
      }
    });

  // Multicollinearity
  if (relationships.multicollinearPairs.length > 0) {
    const pairs = relationships.multicollinearPairs.slice(0, 2)
      .map(p => `"${p.col1}" ↔ "${p.col2}"`)
      .join(", ");
    push("warning",
      "Highly Correlated Features",
      `${relationships.multicollinearPairs.length} pair${relationships.multicollinearPairs.length > 1 ? "s" : ""} of nearly identical features: ${pairs}. Consider dropping one from each pair.`,
      75
    );
  }

  // Moderate class imbalance
  if (classBalance?.isImbalanced) {
    const nonMissing = classBalance.classes.filter(c => !c.missing);
    const majority   = nonMissing[0];
    const minority   = nonMissing[nonMissing.length - 1];   // smallest class = binding constraint
    const majPct     = majority?.pct ?? 0;
    if (majPct <= 90) {
      push("warning",
        "Class Imbalance",
        `Target class "${majority.value}" represents ${majPct}% of data. Consider class-weighted training.` +
        ` The smallest class "${minority.value}" has ${minority.count} sample(s)${minorityFlavor(minority.count)}.`,
        72
      );
    }
  }

  // Outliers in features
  const colsWithOutliers = statistics
    .filter(s => !s.empty && s.outlierCount > 0)
    .sort((a, b) => b.outlierCount - a.outlierCount)
    .slice(0, 2);

  if (colsWithOutliers.length > 0) {
    const desc = colsWithOutliers
      .map(s => `"${s.col}" (${s.outlierCount})`)
      .join(", ");
    push("warning",
      "Outliers Detected",
      `Outliers found in ${desc}. Review whether these are valid extreme values or data errors.`,
      65
    );
  }

  // High cardinality
  const hiCard = quality.columnsWithIssues.filter(c => c.issue === "high_cardinality");
  if (hiCard.length > 0) {
    push("warning",
      "High Cardinality Columns",
      `${hiCard.map(c => `"${c.col}"`).join(", ")} ${hiCard.length > 1 ? "have" : "has"} very high uniqueness. Encoding may create sparse features.`,
      62
    );
  }

  // Constant columns
  const constCols = quality.columnsWithIssues.filter(c => c.issue === "constant");
  if (constCols.length > 0) {
    push("warning",
      "Constant Columns",
      `${constCols.map(c => `"${c.col}"`).join(", ")} ${constCols.length > 1 ? "have" : "has"} zero variance and should be removed.`,
      68
    );
  }

  // Row-to-feature ratio — overfitting risk. Count MODELING features only (numeric +
  // categorical already exclude target/identifier/temporal). Silent when ratio ≥ 10.
  const featureCount = meta.numericCols.length + meta.categoricalCols.length;
  if (featureCount >= 2 && meta.rows > 0) {
    const ratio     = meta.rows / featureCount;
    const ratioStr  = ratio.toFixed(1);                 // reads sensibly below 1.0 for p>n
    const hasHiCard = quality.columnsWithIssues.some(c => c.issue === "high_cardinality");
    const caveat    = hasHiCard
      ? " Note: high-cardinality categorical column(s) expand after encoding, which worsens this ratio."
      : "";

    if (ratio < 5) {
      push("warning",
        "High Overfitting Risk",
        `Only ${meta.rows} rows for ${featureCount} modeling features (~${ratioStr} rows per feature). ` +
        `High overfitting risk — models may memorize noise. Consider more data, fewer features, or strong regularization.${caveat}`,
        78
      );
    } else if (ratio < 10) {
      push("info",
        "Limited Rows per Feature",
        `${meta.rows} rows for ${featureCount} features (~${ratioStr} rows per feature). ` +
        `Limited rows per feature — prefer simpler models and cross-validation.${caveat}`,
        55
      );
    }
  }

  /* ── INFO ── */

  // Strong correlations between features (non-critical)
  const strongNonMC = relationships.strongRelationships
    .filter(r => Math.abs(r.correlation) >= 0.7 && Math.abs(r.correlation) < 0.9)
    .slice(0, 2);

  if (strongNonMC.length > 0) {
    const top = strongNonMC[0];
    push("info",
      "Strong Feature Correlations",
      `${top.statement} (r = ${top.correlation.toFixed(2)}, ${top.confidence} estimate).`,
      50
    );
  }

  // Cluster detected
  if (relationships.clusterDetected) {
    push("info",
      "Feature Cluster Detected",
      relationships.observations.find(o => o.includes("cluster")) || "Multiple features are heavily intercorrelated.",
      48
    );
  }

  // Feature-target signal insight
  const noSignalObs  = relationships.observations.find(o => o.includes("No feature shows") || o.includes("no feature shows"));
  const weakSignalObs = relationships.observations.find(o => o.includes("Weak feature-target"));

  if (noSignalObs) {
    push("warning",
      "No Feature-Target Signal Detected",
      noSignalObs,
      60
    );
  } else if (weakSignalObs) {
    push("info",
      "Weak Feature-Target Signal",
      weakSignalObs,
      45
    );
  } else if (meta.target && Object.keys(relationships.targetCorrelations).length > 0) {
    // Positive signal — rank features by |association| and surface the top 3.
    const ranked = Object.entries(relationships.targetCorrelations)
      .sort((a, b) => (b[1]?.absValue ?? 0) - (a[1]?.absValue ?? 0));

    // Gate unchanged: only fire when the strongest feature clears 0.3.
    if (ranked[0] && (ranked[0][1]?.absValue ?? 0) >= 0.3) {
      // Per-feature metric-correct label (never label Cramér's V / η as "r").
      // Direction (↑/↓) ONLY for signed Pearson r — Cramér's V and η are unsigned.
      const fmt = ([col, e]) => {
        const label = e?.metric === "cramers_v" ? "Cramér's V"
                    : e?.metric === "eta"        ? "η" : "r";
        const dir   = e?.metric === "pearson"
                    ? (e.value > 0 ? " ↑" : e.value < 0 ? " ↓" : "") : "";
        return `"${col}" (${label}=${(e?.absValue ?? 0).toFixed(2)}${dir})`;
      };

      // #1 is guaranteed ≥0.3 (the gate); the "next strongest" may be <0.3 and are
      // framed honestly as such, not presented as strong. Tolerates a 1–3 length dict.
      const strongest = fmt(ranked[0]);
      const rest      = ranked.slice(1, 3).map(fmt);
      const body = rest.length
        ? `Strongest predictor of "${meta.target}": ${strongest}. Next strongest: ${rest.join(", ")}.`
        : `Strongest predictor of "${meta.target}": ${strongest}.`;

      push("info", "Top Predictors of Target", body, 48);
    }
  }

  // Temporal FEATURES — date columns among the predictors. Exclude the target: temporalCols
  // does NOT drop the target (unlike numericCols/categoricalCols), so filter it here to avoid
  // telling the user to feature-engineer the target.
  const temporalFeatures = (meta.temporalCols ?? []).filter(c => c !== meta.target);
  if (temporalFeatures.length > 0) {
    push("info",
      "Date Columns Detected",
      `Date column(s) detected: ${temporalFeatures.join(", ")}. Raw dates aren't directly usable by ` +
      `most models — consider extracting year / month / day-of-week / is-weekend as features. ` +
      `(These columns are excluded from correlation and numeric stats.)`,
      50
    );
  }

  // Temporal TARGET — the target itself is a date → forecasting problem (datasetType set to
  // "Time Series" by getMeta when targetRole === TEMPORAL). Reframes the whole analysis.
  if (meta.datasetType === "Time Series") {
    push("info",
      "Temporal Target (Forecasting)",
      `The target "${meta.target}" is a date/time column, so this is a forecasting problem. ` +
      `This analysis covers tabular data quality and structure — it does not perform time-series ` +
      `forecasting (trend/seasonality/lags) yet. Interpret the readiness signals with that scope in mind.`,
      58
    );
  }

  // Heavy-tailed features — excess kurtosis > 3 (leptokurtic, outlier-prone). A distribution-
  // SHAPE signal, distinct from the outlier-count warning; info@46 so Outliers leads when both
  // fire. Constant / n<4 columns auto-excluded (kurtosis returns 0). Composite: top-3 desc.
  const heavyTailed = statistics
    .filter(s => !s.empty && typeof s.kurtosis === "number" && s.kurtosis > 3)
    .sort((a, b) => b.kurtosis - a.kurtosis)
    .slice(0, 3);
  if (heavyTailed.length > 0) {
    const list = heavyTailed.map(s => `"${s.col}" (kurtosis=${s.kurtosis.toFixed(1)})`).join(", ");
    push("info",
      "Heavy-Tailed Features",
      `Heavy-tailed distributions: ${list}. These features have more extreme values than a ` +
      `normal distribution — consider robust scaling, a transform (log/Box-Cox), or outlier-robust models.`,
      46
    );
  }

  /* ── SUCCESS ── */

  // Clean dataset — FIX #4: require duplicates to have actually been checked;
  // never claim "clean" when the duplicate scan was skipped (duplicateRows === null).
  if (quality.missingCells === 0 && quality.duplicatesComputed && quality.duplicateRows === 0) {
    push("success",
      "Dataset is Clean",
      "No missing values or duplicate rows detected.",
      40
    );
  }

  // Balanced classes. An identifier target passes the plain imbalance test —
  // 891 classes of one row each have a majority/minority ratio of exactly 1.0 —
  // so this used to print a green "Classes are Balanced" for PassengerId.
  if (classBalance && !classBalance.isImbalanced && !meta.targetIsIdentifier) {
    const majority = classBalance.classes.filter(c => !c.missing)[0];
    push("success",
      "Classes are Balanced",
      `Target classes are well-distributed — majority class at ${majority?.pct ?? "?"}%.`,
      38
    );
  }

  // No multicollinearity
  if (relationships.multicollinearPairs.length === 0 && relationships.cols.length >= 2) {
    push("success",
      "No Highly Correlated Pairs",
      "No near-perfect correlations between features — low redundancy.",
      35
    );
  }

  // Sort by priorityScore descending
  insights.sort((a, b) => b.priorityScore - a.priorityScore);

  return insights.slice(0, 8);
}