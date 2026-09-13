import { ROLE } from "../roles.constants.js";

/* Which columns the advice has already decided about, and how. ONE function, read
   by getRecommendations and by the insight cards, because the cards were a second
   copy of the same judgement and drifted: they showed "Critical Missing Values" and
   "Possible Target Leakage" side by side for one column, and "Highly Correlated
   Features" for a pair the recommendations had already replaced.
     dropped  — identifier, empty, or constant with no gaps: remove it
     replaced — more than half missing, or constant where recorded: its presence
                indicator replaces it
     leaking  — under leakage investigation; outranks the other two
   The target is never in any of them — it has its own advice. */
export function columnDecisions({ meta, quality, relationships }) {
  const dropped = new Set(meta.identifierCols), replaced = new Set();
  const leaking = new Set(relationships.leakageSuspects.map(l => l.col));
  const missing = new Map(quality.columnsWithIssues.filter(c => c.issue === "missing").map(c => [c.col, c.count]));
  for (const [col, count] of missing) {
    if (col === meta.target) continue;
    if (count >= meta.rows) dropped.add(col);
    else if (Math.round((count / meta.rows) * 100) > 50) replaced.add(col);
  }
  quality.columnsWithIssues
    .filter(c => c.issue === "constant" && c.col !== meta.target)
    .forEach(c => (missing.has(c.col) ? replaced : dropped).add(c.col));
  const notKept = new Set([...dropped, ...replaced, ...leaking]);
  return { dropped, replaced, leaking, notKept };
}

export function getRecommendations({ meta, quality, statistics, relationships, classBalance, visualizations = [] }) {
  const recs = [];

  const push = (rec) => recs.push(rec);

  /* Columns whose advice is already final: drop it (identifier, constant, empty)
     or investigate it as leakage first. Any other advice about the same column is
     either moot or a contradiction — smoking.csv told the reader to BUILD
     "type_present" two lines below flagging that very indicator as a restatement
     of the label, and house_prices.csv advised imputing "Status" while telling
     them to drop it as constant. `settle` records the rec that decides the column;
     the rest are removed at the end. */
  const settled = new Map();
  const settle = (rec) => {
    push(rec);
    // Leakage outranks any other decision about a column — investigate it first.
    if (!settled.has(rec.column) || rec.category === "Data Integrity") settled.set(rec.column, rec);
  };

  /* Advice was type-blind: every rule keyed off a quality flag or a statistic
     and never asked what KIND of column it was talking about. meta.columnRoles
     has existed all along and was never consulted here. */
  const roleOf   = col => meta.columnRoles?.[col];

  /* Whether a column was recorded at all, measured against the target. The advice
     below used to assert that missingness "often correlates with something
     meaningful" and stop there — a claim about datasets in general, offered in
     place of the answer for THIS one, which relations.js can now supply. */
  const presenceOf = new Map((relationships.presenceSignals ?? []).map(p => [p.col, p]));
  const catViz   = new Map(visualizations.filter(v => v.type === "categorical").map(v => [v.col, v]));

  /* What to say about the presence indicator: the measured association where
     there is one, and an honest "not measured to matter here" where there is
     not. Both are more use than a general claim about data. */
  const presenceRationale = (col) => {
    const p = presenceOf.get(col);
    if (!p) {
      return "Whether the value exists at all is still real, measured information — here it shows no notable "
           + "association with the target, so keep the indicator only if domain knowledge says the missingness means something.";
    }
    return `Whether the value exists at all is not noise here: the presence indicator alone is associated with `
         + `"${meta.target}" at Cramér's V ${p.cramersV.toFixed(2)} over ${p.n} rows`
         + `${p.cramersV >= 0.95 ? " — it separates the target almost perfectly, so check it is not simply a restatement of the label" : ""}.`;
  };

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
  const lightlyMissingAll = [];
  quality.columnsWithIssues
    .filter(c => c.issue === "missing")
    .forEach(c => {
      const count  = c.count ?? parseInt(c.detail);   // FIX #3: prefer stored count
      const rawPct = (count / meta.rows) * 100;
      const pct    = rawPct < 1 && rawPct > 0
        ? Math.max(0.1, Math.round(rawPct * 10) / 10)
        : Math.round(rawPct);

      /* The target is never imputed. Every rule below is feature advice, and it
         used to reach the target too — "Impute Price with median" invents the
         answer a model is then graded against. A constant target has its own,
         more fundamental advice below. */
      if (c.col === meta.target) {
        if (meta.targetIsConstant) return;
        push({
          category:  "Data Integrity",
          priority:  pct > 20 ? "high" : "medium",
          column:    c.col,
          issue:     `Target has missing values (${pct}%)`,
          action:    `Drop the ${count} row${count === 1 ? "" : "s"} where "${c.col}" is missing before training — do not impute the target.`,
          rationale: `An imputed target is a label the engine made up: the model would be trained to reproduce the imputation and evaluated against it. `
                   + `Rows without a label cannot teach or test anything supervised.`,
        });
        return;
      }

      const { method, why } = imputationFor(c.col);

      /* Nothing was ever recorded: there is no value to impute and no presence
         to encode — an indicator built from it would be a constant. */
      if (count >= meta.rows) {
        settle({
          category:  "Feature Selection",
          priority:  "high",
          column:    c.col,
          issue:     "Empty column",
          action:    `Drop "${c.col}" — it has no values at all.`,
          rationale: `Every row of "${c.col}" is missing, so neither the value nor its presence carries anything a model could use.`,
        });
        return;
      }

      if (pct > 50) {
        /* "Just drop it" throws away the one thing a mostly-empty column still
           reliably carries: WHETHER the value was present. On titanic, Cabin is
           77% missing and its missingness tracks passenger class closely — the
           presence flag survives even though the value does not.
           It settles the column: outlier, skew or pair advice about a column
           being replaced is moot. */
        settle({
          category:  "Data Cleaning",
          priority:  "high",
          column:    c.col,
          issue:     `Missing values (${pct}%)`,
          action:    `Replace "${c.col}" with a binary "${c.col}_present" indicator rather than dropping it outright, then drop the original.`,
          rationale: `${pct}% missing is past the point where imputing the VALUE is defensible — ${method} would be invented for ${pct}% of rows. `
                   + presenceRationale(c.col),
        });
      } else if (pct > 20) {
        push({
          category:  "Data Cleaning",
          priority:  "high",
          column:    c.col,
          issue:     `Missing values (${pct}%)`,
          action:    `Impute "${c.col}" with ${method}, and add a binary "${c.col}_was_missing" indicator alongside it.`,
          rationale: `${pct}% missing is high enough that the imputed value becomes a real part of the column — ${why}. `
                   + `The indicator lets the model separate imputed rows from measured ones instead of treating them as equally trustworthy. `
                   + presenceRationale(c.col),
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
        lightlyMissingAll.push({ col: c.col, count, pct, method });
      }
    });

  /* Pair advice ("drop one of", "use a non-linear model for both") assumes both
     columns stay. ginf.csv advised dropping one of odd_bts / odd_bts_n two lines
     after replacing both with presence indicators. */
  const { notKept } = columnDecisions({ meta, quality, relationships });
  const bothKept = (a, b) => !notKept.has(a) && !notKept.has(b);

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
    .filter(c => c.issue === "constant" && c.col !== meta.target)
    .forEach(c => {
      /* Constant where recorded, but not recorded everywhere: the value carries
         nothing, and WHETHER it was recorded is the only information left. "Drop
         it" and "impute it with its mode" both threw that away, and they were
         issued side by side. */
      const gaps = quality.columnsWithIssues.find(m => m.col === c.col && m.issue === "missing");
      if (gaps) {
        settle({
          category:  "Feature Engineering",
          priority:  "medium",
          column:    c.col,
          issue:     "Constant where recorded",
          action:    `Replace "${c.col}" with a binary "${c.col}_present" indicator, or drop it — its recorded values are all identical.`,
          rationale: `Every recorded value of "${c.col}" is the same, so the value itself carries nothing; only its ${gaps.count} missing rows vary. `
                   + presenceRationale(c.col),
        });
        return;
      }
      settle({
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
    settle({
      category:  "Feature Selection",
      priority:  "high",
      column:    col,
      issue:     "Identifier column",
      action:    `Drop "${col}" as a feature before training — it identifies a row or an entity rather than describing one. If its values repeat, it is a key: join on it to bring in the other table's columns, or group the train/test split on it so one entity never lands on both sides.`,
      rationale: "An identifier leaks row or entity identity into the model: it memorises who, not why, and scores well on training data it will never see again. A repeated key also means rows are not independent — a random split puts the same entity in train and test and overstates accuracy.",
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
          action:    `Investigate the values of "${s.col}" outside ${s.lowerFence} – ${s.upperFence} before applying any treatment. These may represent valid extreme values rather than errors.`,
          rationale: `${outlierPct}% of values fall outside the skew-adjusted fences (${s.lowerFence} – ${s.upperFence}), which already allow for a long tail — a rate this high after that adjustment is worth a domain check before removing or capping anything.`,
        });
      } else if (outlierPct > 2) {
        push({
          category:  "Data Cleaning",
          priority:  "low",
          column:    s.col,
          issue:     `${s.outlierCount} outliers (${outlierPct}%)`,
          action:    `Review the values of "${s.col}" outside ${s.lowerFence} – ${s.upperFence}. If they are errors, cap them at those fences; if they are real, leave them.`,
          rationale: `${outlierPct}% of values fall outside the skew-adjusted fences. The advice caps at the same cutoff that flagged them — it used to detect with one rule and suggest capping at the 1st/99th percentile, a different one. Verify whether they are errors or real observations first.`,
        });
      }
    });

  /* ── Skewed features ──
     A log transform is for a CONTINUOUS measurement with a long tail. Applied to
     a small-integer COUNT it does close to nothing useful: titanic's SibSp has
     skew 3.7, but it takes 7 distinct values from 0 to 8, and its skew is the
     shape of a count that is mostly zero rather than a heavy tail to compress.
     The old rule could not tell those apart because it looked only at the
     skewness number, so it advised log1p on both.

     A negative minimum matters too: log1p is undefined at or below -1, and the
     old text mentioned that only as a trailing note the user had to check by
     hand. Now it decides the advice. */
  statistics
    .filter(s => !s.empty && Math.abs(s.skewness) > 2)
    .forEach(s => {
      const direction = s.skewness > 0 ? "right" : "left";
      const spread    = s.max - s.min;
      const isCount   = Number.isInteger(s.min) && Number.isInteger(s.max)
                        && s.min >= 0 && spread <= 20;

      if (isCount) {
        push({
          category:  "Feature Engineering",
          priority:  "low",
          column:    s.col,
          issue:     `Skewed count (${s.skewness > 0 ? "+" : ""}${s.skewness}, values ${s.min}–${s.max})`,
          action:    `Leave "${s.col}" as-is, or bin it into ranges (e.g. 0 / 1 / 2+). A log transform is not useful here.`,
          rationale: `"${s.col}" is a small-integer count spanning only ${s.min}–${s.max}. Its skew of ${s.skewness} comes from most rows sitting at the low end, not from a long tail that a log would compress — the transform would barely change the ordering. Binning captures the real distinction (none / one / several).`,
        });
        return;
      }

      if (s.min <= -1) {
        push({
          category:  "Feature Engineering",
          priority:  "low",
          column:    s.col,
          issue:     `High skewness (${s.skewness > 0 ? "+" : ""}${s.skewness})`,
          action:    `Use a Yeo-Johnson power transform for "${s.col}" — not log1p.`,
          rationale: `Skewness of ${s.skewness} is high, but "${s.col}" reaches ${s.min}, and log1p is undefined at or below -1. Yeo-Johnson handles negative values; a signed square root is a simpler alternative.`,
        });
        return;
      }

      push({
        category:  "Feature Engineering",
        priority:  "low",
        column:    s.col,
        issue:     `High skewness (${s.skewness > 0 ? "+" : ""}${s.skewness})`,
        action:    `Apply a log1p transform to "${s.col}" to reduce ${direction}-skew.`,
        rationale: `Skewness of ${s.skewness} over a range of ${s.min}–${s.max} is a genuine long tail, and many algorithms assume roughly symmetric features. All values are ≥ 0, so log1p is safe to apply directly.`,
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
    .filter(c => c.issue === "high_cardinality" && c.col !== meta.target)
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

  /* ── The target itself ──
     Every rule here advised on FEATURES. Nothing ever questioned the target,
     so a user who picked an unusable one got a full page of careful feature
     advice and no hint that the whole analysis was built on a column nothing
     can be learned from. Stage 5 detects this for the score; it was never
     turned into advice. */
  if (meta.target && meta.targetIsIdentifier) {
    push({
      category:  "Data Integrity",
      priority:  "high",
      column:    meta.target,
      issue:     "Target is an identifier",
      action:    `Pick a different target column — "${meta.target}" is unique per row, so there is nothing in it to predict.`,
      rationale: `Every row has its own value of "${meta.target}", which means a model would have to memorise the dataset rather than learn a pattern. Every other recommendation on this page is scoped to this target, so change it first and re-run.`,
    });
  }

  if (meta.target && meta.targetIsConstant) {
    push({
      category:  "Data Integrity",
      priority:  "high",
      column:    meta.target,
      issue:     "Target never varies",
      action:    `Pick a different target column — every row of "${meta.target}" has the same value, so there is nothing to predict.`,
      rationale: `A model trained on a single-valued target learns to output that value and nothing else. Every other recommendation on this page is scoped to this target, so change it first and re-run.`,
    });
  }

  if (meta.target && !meta.targetIsIdentifier && !meta.targetIsConstant) {
    const entries  = Object.values(relationships.targetCorrelations ?? {});
    const strongest = entries.reduce((best, e) => (e.absValue ?? 0) > (best?.absValue ?? 0) ? e : best, null);
    const anySignificant = entries.some(e => e.pValue != null && e.pValue < 0.05);
    if (entries.length > 0 && (strongest?.absValue ?? 0) < 0.1 && !anySignificant) {
      push({
        category:  "Modeling",
        priority:  "high",
        column:    meta.target,
        issue:     "No feature shows a detectable relationship with the target",
        action:    `Before modelling "${meta.target}", engineer new features or bring in additional data — the columns present do not explain it.`,
        rationale: `The strongest association with "${meta.target}" is ${(strongest?.absValue ?? 0).toFixed(2)}, and no feature reaches statistical significance. A model trained on these columns as they stand will not do much better than predicting the base rate.`,
      });
    }
  }

  /* ── Class imbalance ── */
  if (classBalance && classBalance.isImbalanced && !meta.targetIsIdentifier && !meta.targetIsConstant) {
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
  relationships.multicollinearPairs.filter(pair => bothKept(pair.col1, pair.col2)).forEach(pair => {
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

  /* ── Monotonic but not linear (stage 7) ──
     Pearson and Spearman disagreeing IS the finding, and until now nothing acted
     on it. A pair the linear scan calls weak while the rank scan calls it strong
     is a relationship a linear model will underfit. */
  relationships.strongRelationships
    .filter(sr => sr.monotonicNotLinear && bothKept(sr.col1, sr.col2))
    .forEach(sr => {
      push({
        category:  "Modeling",
        priority:  "medium",
        column:    null,
        issue:     `Non-linear relationship: "${sr.col1}" ↔ "${sr.col2}" (Pearson ${sr.correlation.toFixed(2)}, Spearman ${sr.spearman.toFixed(2)})`,
        action:    `Use a rank-based or non-linear model for "${sr.col1}" and "${sr.col2}", or transform one of them so the relationship straightens out.`,
        rationale: `Spearman ${sr.spearman.toFixed(2)} against Pearson ${sr.correlation.toFixed(2)} means the two move together reliably but not along a straight line. A linear model reads only the Pearson figure and will treat this as a weak relationship when it is not.`,
      });
    });

  /* ── Categorical redundancy (stage 7) ──
     multicollinearPairs only ever covered NUMERIC columns, so two categorical
     features encoding the same thing produced no advice at all.

     V is symmetric, dependency is not. With 9,676 Societies against 3
     Furnishing levels, a high V says each Society maps to mostly one Furnishing
     — it cannot say the reverse, because 3 levels cannot name 9,676. "Keep one of
     the two" was wrong for every such pair (drop Society and its detail is gone),
     and house_prices.csv issued it 15 times, once per pair. Uneven pairs are now
     grouped under the column that determines the others; only pairs of similar
     grain keep the "one of the two" advice. Columns already settled (dropped,
     replaced by a presence indicator, or under leakage investigation) are left
     out — "if you keep Society" beside "replace Society" was one more contradiction. */
  const UNEVEN_LEVELS = 3;
  const fmtV = v => v.toFixed(2);
  const determines = new Map();
  (relationships.categoricalAssociations ?? [])
    .filter(a => a.cramersV >= 0.6 && bothKept(a.col1, a.col2))
    .forEach(a => {
      const [l1, l2] = a.levels;
      if (Math.max(l1, l2) >= UNEVEN_LEVELS * Math.min(l1, l2)) {
        const [fine, fineLevels, coarse, coarseLevels] = l1 > l2 ? [a.col1, l1, a.col2, l2] : [a.col2, l2, a.col1, l1];
        if (!determines.has(fine)) determines.set(fine, { levels: fineLevels, rows: a.nPairs, coarse: [] });
        determines.get(fine).coarse.push({ col: coarse, levels: coarseLevels, v: a.cramersV });
        return;
      }
      push({
        category:  "Feature Selection",
        priority:  "medium",
        column:    null,
        issue:     `Redundant categoricals: "${a.col1}" ↔ "${a.col2}" (Cramér's V ${fmtV(a.cramersV)})`,
        action:    `Keep one of "${a.col1}" or "${a.col2}" — they encode largely overlapping information.`,
        rationale: `Cramér's V of ${fmtV(a.cramersV)} over ${a.nPairs} rows (p = ${a.pValue < 0.001 ? "< 0.001" : a.pValue.toFixed(3)}) between columns of similar grain (${l1} and ${l2} levels) means knowing either largely tells you the other. Encoding both inflates the feature space without adding information.`,
      });
    });

  /* Too fine to be a feature at all. openpowerlifting.csv's lifter "Name" has
     136,687 levels over 386,414 rows — 2.8 rows each — and determines "Sex"; the
     advice "if you keep Name, Sex adds little" offered a column no model can learn
     from as the one to keep. Measured: the fine side of every legitimate grouping in
     the corpus has more than 5 rows per level (MeetTown 5.6, Society 7, Carpet Area
     34, team 68), and the two entity columns have under 3 (Name 2.8, MeetName 1.6). */
  const TOO_FINE_ROWS_PER_LEVEL = 5;
  determines.forEach(({ levels, rows, coarse }, fine) => {
    const names = coarse.map(c => `"${c.col}"`).join(", ");
    const perLevel = rows / levels;
    if (perLevel < TOO_FINE_ROWS_PER_LEVEL) {
      push({
        category:  "Feature Selection",
        priority:  "medium",
        column:    fine,
        issue:     `"${fine}" is too fine to learn from (${levels} levels, ~${perLevel.toFixed(1)} rows each) and largely determines ${names}`,
        action:    `Keep ${names} and do not use "${fine}" as a feature. Use "${fine}" only to group the train/test split, so one entity never lands on both sides.`,
        rationale: `Association is one-directional: each "${fine}" value maps to mostly one value of ${names} (${coarse.map(c => `V ${fmtV(c.v)}`).join(", ")}), and the reverse cannot hold. `
                 + `At ~${perLevel.toFixed(1)} rows per level a model can only memorise "${fine}" — the part of it that generalises is already in ${names}.`,
      });
      return;
    }
    push({
      category:  "Feature Selection",
      priority:  "medium",
      column:    fine,
      issue:     `"${fine}" (${levels} levels) largely determines ${coarse.length === 1 ? names : `${coarse.length} coarser columns`}`,
      action:    `If you keep "${fine}", ${names} add${coarse.length === 1 ? "s" : ""} little on top of it. If you drop "${fine}", keep ${coarse.length === 1 ? "it" : "them"} — ${coarse.length === 1 ? "it does" : "they do"} not carry its detail. They are not interchangeable.`,
      rationale: `Association is one-directional here: ${coarse.map(c => `"${c.col}" ${c.levels} level${c.levels === 1 ? "" : "s"}, V ${fmtV(c.v)}`).join("; ")}. `
               + `A high Cramér's V between ${levels} levels and far fewer means each "${fine}" value maps to mostly one value of the coarser column — the reverse cannot hold, so "keep one of the two" would lose information.`,
    });
  });

  /* ── Signal the correlations cannot see (stage 7) ──
     Mutual information is non-zero while both correlations are ~0: the feature
     carries information about the target through a shape that is not monotonic.
     Dropping it for "low correlation" would be a mistake. */
  Object.entries(relationships.targetCorrelations ?? {})
    .filter(([, e]) => (e.mi ?? 0) >= 0.15 && (e.absValue ?? 0) < 0.15)
    .forEach(([col, e]) => {
      push({
        category:  "Feature Selection",
        priority:  "medium",
        column:    col,
        issue:     `Non-monotonic signal (correlation ${e.value}, mutual information ${e.mi})`,
        action:    `Keep "${col}" despite its low correlation, and give it to a model that can use non-linear structure (trees, gradient boosting).`,
        rationale: `"${col}" correlates with the target at only ${e.value}, so a correlation-based feature filter would drop it — but mutual information of ${e.mi} says it does carry information about the target. The relationship is real and simply is not monotonic.`,
      });
    });

  /* ── Target leakage ──
     Leakage is decided BEFORE the per-column advice it supersedes is filtered,
     so it is pushed ahead of the filter below. The label follows the metric: a
     presence leak was printed "r = 1.00", which is a statistic nobody computed. */
  const LEAK_LABEL = { pearson: "r", cramers_v: "Cramér's V", presence: "Cramér's V of its presence" };
  // One item per column: meets.csv "MeetState" leaks through its value AND its presence.
  const leaksByCol = new Map();
  relationships.leakageSuspects.forEach(leak => leaksByCol.set(leak.col, [...(leaksByCol.get(leak.col) ?? []), leak]));
  leaksByCol.forEach((leaks, col) => {
    settle({
      category:  "Data Integrity",
      priority:  "high",
      column:    col,
      issue:     `Possible target leakage (${leaks.map(l => `${LEAK_LABEL[l.metric] ?? l.metric} = ${l.correlation.toFixed(2)}`).join(", ")})`,
      action:    `Investigate "${col}". ${leaks.map(l => l.warning).join(" ")}`,
      rationale: "Target leakage causes models to appear highly accurate during training but fail completely in production.",
    });
  });

  const decided = recs.filter(r => !r.column || r.column === meta.target
                                 || !settled.has(r.column) || settled.get(r.column) === r
                                 || r.category === "Data Integrity");
  recs.length = 0;
  recs.push(...decided);

  /* One item for every lightly-missing column, not one each. The advice is the
     same for all of them, and house_prices.csv listed six near-identical rows of
     it — part of how a report reached 37 recommendations that nobody reads to the
     end. Grouped by imputation method, so the role-aware choice survives. */
  const lightlyMissing = lightlyMissingAll.filter(m => !settled.has(m.col));
  if (lightlyMissing.length === 1) {
    const { col, count, pct, method } = lightlyMissing[0];
    push({
      category:  "Data Cleaning",
      priority:  "low",
      column:    col,
      issue:     `Missing values (${pct}%)`,
      action:    `Drop the ${count} affected row${count === 1 ? "" : "s"}, or impute "${col}" with ${method}.`,
      rationale: `Only ${pct}% of rows are affected, so deleting them costs little${meta.rows > 100 ? "" : " — though with only " + meta.rows + " rows, imputing is safer than losing any"}.`,
    });
  } else if (lightlyMissing.length > 1) {
    const byMethod = new Map();
    lightlyMissing.forEach(m => byMethod.set(m.method, [...(byMethod.get(m.method) ?? []), `"${m.col}"`]));
    push({
      category:  "Data Cleaning",
      priority:  "low",
      column:    null,
      issue:     `Few missing values in ${lightlyMissing.length} columns (≤ 5% each)`,
      action:    `Drop the affected rows, or impute: ${[...byMethod].map(([method, cols]) => `${cols.join(", ")} with ${method}`).join("; ")}.`,
      rationale: `${lightlyMissing.map(m => `"${m.col}" ${m.pct}%`).join(", ")} — each small enough that deleting its rows costs little${meta.rows > 100 ? "" : ", though with only " + meta.rows + " rows imputing is safer than losing any"}.`,
    });
  }

  /* ── Statistically indistinguishable from chance (stage 7) ──
     Columns already handled by a mostly-missing rule are excluded. Telling the
     user to keep "Cabin_present" and to drop "Cabin" in the same list reads as
     the engine contradicting itself, and the missing-value advice is the more
     specific of the two. */
  const alreadyHandled = new Set(
    recs.filter(r => r.priority === "high" && /Missing values/.test(r.issue)).map(r => r.column),
  );
  const indistinct = Object.entries(relationships.targetCorrelations ?? {})
    .filter(([col, e]) => !alreadyHandled.has(col) && !settled.has(col)
      && e.pValue != null && e.pValue > 0.05 && (e.mi ?? 0) < 0.15);
  if (indistinct.length === 1) {
    const [col, e] = indistinct[0];
    push({
      category:  "Feature Selection",
      priority:  "low",
      column:    col,
      issue:     `No detectable relationship with target (p = ${e.pValue.toFixed(2)})`,
      action:    `Consider dropping "${col}" — or keep it only if domain knowledge says it matters.`,
      rationale: `The association with "${meta.target}" is ${e.value}, and at ${e.n} rows that is not distinguishable from chance (p = ${e.pValue.toFixed(2)}). This is a statement about THIS sample, not proof the column is useless — a larger dataset could separate it.`,
    });
  } else if (indistinct.length > 1) {
    // Grouped for the same reason as the lightly-missing columns above.
    push({
      category:  "Feature Selection",
      priority:  "low",
      column:    null,
      issue:     `No detectable relationship with target in ${indistinct.length} columns`,
      action:    `Consider dropping ${indistinct.map(([c]) => `"${c}"`).join(", ")} — or keep any that domain knowledge says matters.`,
      rationale: `${indistinct.map(([c, e]) => `"${c}" ${e.value} (p = ${e.pValue.toFixed(2)}, n = ${e.n})`).join("; ")}. None is distinguishable from chance in THIS sample, which is not proof a column is useless — a larger dataset could separate it.`,
    });
  }


  /* Sort: high → medium → low, and within one priority put Data Integrity
     first. An integrity problem — an identifier target, a leaking feature —
     invalidates every other recommendation on the page, so it must not appear
     underneath the advice it makes irrelevant. Sort is otherwise stable, so
     rules keep the order they were written in. */
  const ORDER    = { high: 0, medium: 1, low: 2 };
  const CATEGORY = { "Data Integrity": 0 };
  recs.sort((a, b) =>
    ((ORDER[a.priority] ?? 3) - (ORDER[b.priority] ?? 3))
    || ((CATEGORY[a.category] ?? 1) - (CATEGORY[b.category] ?? 1)));

  return recs;
}