import { columnDecisions } from "./recommendations.js";
import { sharePct } from "../helpers.js";

export function getPriorityInsights({ meta, quality, statistics, relationships, classBalance }) {
  const insights = [];

  /* The cards follow the same per-column decisions as the recommendations — see
     columnDecisions(). A card about a column the advice already dropped, replaced
     or sent to a leakage check contradicts the list beside it. */
  const { dropped, leaking, notKept } = columnDecisions({ meta, quality, relationships });
  const kept     = col => !notKept.has(col) && col !== meta.target;
  const bothKept = (a, b) => kept(a) && kept(b);

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

  // The target is unusable — nothing else on the page matters until it changes.
  if (meta.targetIsConstant) {
    push("critical",
      "Target Never Varies",
      `Every row of "${meta.target}" has the same value — there is nothing to predict. Pick a different target.`,
      101
    );
  }

  // Target leakage — one card per column (meets.csv "MeetState" leaks by value AND by presence)
  const leakByCol = new Map();
  relationships.leakageSuspects.forEach(l => leakByCol.set(l.col, [...(leakByCol.get(l.col) ?? []), l.warning]));
  leakByCol.forEach(warnings => {
    push("critical",
      "Possible Target Leakage",
      /* The warning is composed where the metric is known. Re-writing it here
         printed "r = 0.99" for a Cramér's V, which is a different statistic. */
      warnings.join(" "),
      100
    );
  });

  /* Missing values, one card per SEVERITY rather than per column: ginf.csv spent
     four of its eight cards on the same sentence about four odds columns. A
     leaking or dropped column is left to its own card and advice. */
  const pctOf = c => sharePct(c.count ?? parseInt(c.detail), meta.rows);
  const missingCols = quality.columnsWithIssues.filter(c => c.issue === "missing" && c.col !== meta.target);
  const sparse = missingCols.filter(c => pctOf(c) > 50 && !leaking.has(c.col) && !dropped.has(c.col));
  if (sparse.length === 1) {
    const c = sparse[0];
    push("critical",
      `Critical Missing Values in "${c.col}"`,
      `${pctOf(c)}% of values in "${c.col}" are missing — too sparse to impute. See the recommendations for keeping its presence as an indicator.`,
      98
    );
  } else if (sparse.length > 1) {
    push("critical",
      `Critical Missing Values in ${sparse.length} Columns`,
      `${sparse.map(c => `"${c.col}" (${pctOf(c)}%)`).join(", ")} are more than half empty — too sparse to impute. See the recommendations for keeping their presence as indicators.`,
      98
    );
  }

  // Severe class imbalance — meaningless for a single-valued or per-row-unique target
  const classesMeaningful = !meta.targetIsConstant && !meta.targetIsIdentifier;
  if (classesMeaningful && classBalance?.isImbalanced) {
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
  const moderate = missingCols.filter(c => pctOf(c) > 5 && pctOf(c) <= 50 && !notKept.has(c.col));
  if (moderate.length === 1) {
    const c = moderate[0];
    push("warning",
      `Missing Values in "${c.col}"`,
      `${pctOf(c)}% of values in "${c.col}" are missing — imputation recommended.`,
      70 + pctOf(c) * 0.3
    );
  } else if (moderate.length > 1) {
    push("warning",
      `Missing Values in ${moderate.length} Columns`,
      `${moderate.map(c => `"${c.col}" (${pctOf(c)}%)`).join(", ")} — imputation recommended; see the recommendations for the method per column.`,
      70 + moderate.reduce((m, c) => Math.max(m, pctOf(c)), 0) * 0.3
    );
  }

  // The target's own missing rows: drop, never impute.
  const targetMissing = quality.columnsWithIssues.find(c => c.issue === "missing" && c.col === meta.target);
  if (targetMissing && !meta.targetIsConstant && pctOf(targetMissing) > 5) {
    push("warning",
      `Missing Values in the Target "${meta.target}"`,
      `${pctOf(targetMissing)}% of target values are missing — drop those rows; never impute the target.`,
      70 + Math.min(50, pctOf(targetMissing)) * 0.3
    );
  }

  // Multicollinearity
  const keptPairs = relationships.multicollinearPairs.filter(p => bothKept(p.col1, p.col2));
  if (keptPairs.length > 0) {
    const pairs = keptPairs.slice(0, 2)
      .map(p => `"${p.col1}" ↔ "${p.col2}"`)
      .join(", ");
    push("warning",
      "Highly Correlated Features",
      `${keptPairs.length} pair${keptPairs.length > 1 ? "s" : ""} of nearly identical features: ${pairs}. Consider dropping one from each pair.`,
      75
    );
  }

  // Moderate class imbalance
  if (classesMeaningful && classBalance?.isImbalanced) {
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
    .filter(s => !s.empty && s.outlierCount > 0 && kept(s.col))
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
  const hiCard = quality.columnsWithIssues.filter(c => c.issue === "high_cardinality" && kept(c.col));
  if (hiCard.length > 0) {
    push("warning",
      "High Cardinality Columns",
      `${hiCard.map(c => `"${c.col}"`).join(", ")} ${hiCard.length > 1 ? "have" : "has"} very high uniqueness. Encoding may create sparse features.`,
      62
    );
  }

  // Constant columns
  // Only the constants the advice removes: a constant with gaps is kept as its presence indicator.
  const constCols = quality.columnsWithIssues.filter(c => c.issue === "constant" && dropped.has(c.col) && !leaking.has(c.col));
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
    .filter(r => Math.abs(r.correlation) >= 0.7 && Math.abs(r.correlation) < 0.9 && bothKept(r.col1, r.col2))
    .slice(0, 2);

  if (strongNonMC.length > 0) {
    const top = strongNonMC[0];
    push("info",
      "Strong Feature Correlations",
      `${top.statement} (r = ${top.correlation.toFixed(2)}, ${top.confidence} estimate).`,
      50
    );
  }

  // Cluster detected — only over columns the advice keeps
  const keptCluster = (relationships.clusterCols ?? []).filter(kept);
  if (relationships.clusterDetected && keptCluster.length >= 3) {
    push("info",
      "Feature Cluster Detected",
      `Feature cluster detected: ${keptCluster.join(", ")} are heavily intercorrelated. Consider dimensionality reduction within this group.`,
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
    .filter(s => !s.empty && typeof s.kurtosis === "number" && s.kurtosis > 3 && kept(s.col))
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
  if (classBalance && !classBalance.isImbalanced && classesMeaningful) {
    const majority = classBalance.classes.filter(c => !c.missing)[0];
    push("success",
      "Classes are Balanced",
      `Target classes are well-distributed — majority class at ${majority?.pct ?? "?"}%.`,
      38
    );
  }

  // No multicollinearity
  // A statement about the data, not the advice: any near-perfect pair at all falsifies it.
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