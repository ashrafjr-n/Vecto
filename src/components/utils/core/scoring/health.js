export function getHealthScore({ meta, quality, relationships, classBalance }) {

  const hasTarget = !!meta.target;

  /* ── Dimension 1: Data Quality ──
     Read, not recomputed. This block used to hold a second, independently written
     quality model working from the same `quality.*` outputs, and the two numbers
     it produced against quality.js's own score were openly different (11 vs 40 on
     openpowerlifting.csv). The weighted model moved into quality.js, which owns
     the inputs; here it is simply the score that file already published. */
  const qualityDim = quality.qualityScore;

  /* ── Dimension 2: Dataset Structure ── */
  const rowScore =
    meta.rows >= 1000 ? 100 :
    meta.rows >= 500  ? 90  :
    meta.rows >= 200  ? 75  :
    meta.rows >= 100  ? 60  :
    meta.rows >= 50   ? 40  : 20;

  const colScore =
    meta.columns >= 5 && meta.columns <= 50 ? 100 :
    meta.columns >= 3 && meta.columns < 5   ? 70  :
    meta.columns > 50 && meta.columns <= 100 ? 85 :
    meta.columns > 100                       ? 70 : 30;

  const hasNumeric     = meta.numericCols.length > 0;
  const hasCategorical = meta.categoricalCols.length > 0;
  const mixScore       = hasNumeric && hasCategorical ? 100 : hasNumeric || hasCategorical ? 70 : 40;

  const structureDim   = (rowScore * 0.45 + colScore * 0.30 + mixScore * 0.25);

  /* ── Dimension 3: Relationships ── */
  const mcPenalty      = Math.min(60, relationships.multicollinearPairs.length * 15);
  const mcScore        = Math.max(0, 100 - mcPenalty);

  // Feature-target signal — works with both Pearson and Cramér's V
  let signalScore = 65; // neutral default (slightly lower — no info = uncertain)
  if (hasTarget && Object.keys(relationships.targetCorrelations).length > 0) {
    // FIX P1 (relations.js) applied here too: targetCorrelations values are
    // {metric, value, absValue} objects since FIX #4, not bare numbers.
    // Math.abs(object) is NaN and every NaN comparison is false, so maxR stayed 0,
    // signalScore fell through to its worst bucket (15) for EVERY dataset with a
    // target, and the relationships dimension was a constant 62 carrying no
    // information at all. Read absValue directly.
    const maxR = Object.values(relationships.targetCorrelations)
      .reduce((m, entry) => Math.max(m, entry?.absValue ?? 0), 0);
    signalScore =
      maxR >= 0.5  ? 100 :
      maxR >= 0.3  ? 80  :
      maxR >= 0.15 ? 55  :
      maxR >= 0.05 ? 35  : 15;
  }

  const relDim = (mcScore * 0.55 + signalScore * 0.45);

  /* ── Dimension 4: Target Readiness ── */
  let targetDim = 70; // neutral when no target
  if (hasTarget) {
    // Target exists
    let tScore = 40;

    // No leakage
    if (relationships.leakageSuspects.length === 0) tScore += 20;

    // FIX #2: Target missing values — use target column count, not overall
    const targetIssue = quality.columnsWithIssues.find(c => c.col === meta.target && c.issue === "missing");
    if (!targetIssue) {
      tScore += 20;
    } else {
      const targetMissingCount = targetIssue.count ?? parseInt(targetIssue.detail);
      const targetMissingPct   = (targetMissingCount / meta.rows) * 100;
      tScore += targetMissingPct < 5 ? 15 : targetMissingPct < 20 ? 5 : 0;
    }

    // Class balance (classification only)
    if (classBalance) {
      // FIX: use isImbalanced from getClassBalance (imbalanceRatio > 3 || maxPct > 80)
      tScore += !classBalance.isImbalanced ? 20 :
                classBalance.classes.filter(c => !c.missing)[0]?.pct < 85 ? 10 : 0;
    } else {
      tScore += 15; // regression — no balance concern
    }

    targetDim = Math.min(100, tScore);
  }

  /* ── Evidence caps ──
     Everything above measures how good the data LOOKS. Nothing above asks
     whether there is enough of it to justify saying so, and the weighting lets
     one strong dimension carry a dataset that has no business being graded.
     Measured before this layer existed:

       2 rows / 2 columns           -> 84 "Good"      (quality 100: nothing is
                                       missing when there is nothing there)
       1 row                        -> 77 "Good"
       titanic, PassengerId target  -> 88 "Good", targetReadiness 100
       titanic, Survived target     -> 93 "Excellent", with Cabin 77% missing

     A cap does not compute a better number — it refuses to claim one, and
     carries the reason so the report can say why instead of just showing a
     smaller figure. Caps only ever lower a score, never raise it. */
  const caps  = [];
  const nRows = `${meta.rows} row${meta.rows === 1 ? "" : "s"}`;

  if (meta.rows < 10) {
    caps.push({ max: 25, reason: `Only ${nRows} — there is not enough data here to assess anything.` });
  } else if (meta.rows < 50) {
    caps.push({ max: 50, reason: `Only ${nRows} — estimates from this few rows are not stable enough to act on.` });
  } else if (meta.rows < 200) {
    caps.push({ max: 75, reason: `${nRows} is a small dataset — treat every figure here as provisional.` });
  }

  // A target that is unique per row has nothing in it to learn. This has to come
  // from meta.targetIsIdentifier: the class-balance test cannot see it, because a
  // legitimate continuous target (price, temperature) is also one row per class.
  if (meta.targetIsIdentifier) {
    caps.push({ max: 40, reason: `The target "${meta.target}" is unique per row — an identifier, not a label. There is nothing in it for a model to predict.` });
  }

  /* Round DOWN, and never to 100. Math.round() called openpowerlifting.csv's
     "Squat4Kg" 100% empty when it holds 1,243 real values out of 386,414 — and a
     user who reads "100% empty" and deletes the column has been told something
     that is not true. 99.7% says the same thing about the column's usefulness
     without claiming it is void. */
  const missingPctText = pct => (pct >= 99.95 && pct < 100 ? "99.9" : String(Math.floor(pct * 10) / 10));

  const worst = quality.worstMissingColumn;
  if (worst && worst.pct >= 90) {
    caps.push({ max: 55, reason: `"${worst.col}" is ${missingPctText(worst.pct)}% empty — it carries almost no information.` });
  } else if (worst && worst.pct >= 50) {
    caps.push({ max: 89, reason: `"${worst.col}" is ${missingPctText(worst.pct)}% missing — that has to be dealt with before this dataset is "Excellent".` });
  }

  const ceiling = caps.reduce((lowest, c) => Math.min(lowest, c.max), 100);

  /* ── Final weighted score ── */
  let score;
  if (hasTarget) {
    score = qualityDim * 0.30 + structureDim * 0.20 + relDim * 0.20 + targetDim * 0.30;
  } else {
    // Redistribute target weight across other three
    score = qualityDim * 0.40 + structureDim * 0.30 + relDim * 0.30;
  }

  const finalScore = Math.round(Math.max(0, Math.min(100, score, ceiling)));

  const grade =
    finalScore >= 90 ? "Excellent" :
    finalScore >= 75 ? "Good"      :
    finalScore >= 60 ? "Fair"      :
    finalScore >= 40 ? "Poor"      : "Critical";

  return {
    score: finalScore,
    grade,
    breakdown: {
      quality:        Math.round(qualityDim),
      structure:      Math.round(structureDim),
      relationships:  Math.round(relDim),
      targetReadiness: Math.round(targetDim),
    },
    /* `qualityBreakdown` used to be re-exported here — the same component list
       quality.qualityComponents now carries, rendered by nothing. Removed rather
       than kept in sync: a second copy of a number is how the first one drifts. */
    limits: caps,
    hasTarget,
  };
}