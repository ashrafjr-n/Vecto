export function getHealthScore({ meta, quality, relationships, classBalance }) {

  const hasTarget = !!meta.target;

  /* ── Dimension 1: Data Quality (weight varies) ── */
  // FIX #1a: Base missing score from overall pct
  const missingScore   = Math.max(0, 100 - quality.missingPct * 2);

  // FIX #1b: Additional per-column severity penalty.
  // A single column with 77% missing is a serious structural problem
  // even if the overall dataset missing% looks small.
  const worstColMissingPct = quality.columnsWithIssues
    .filter(c => c.issue === "missing")
    .reduce((worst, c) => {
      const pct = ((c.count ?? parseInt(c.detail)) / meta.rows) * 100;
      return Math.max(worst, pct);
    }, 0);

  // Penalty: 0 if worst col < 20%, scales to -30 at 100%
  const worstColPenalty = worstColMissingPct > 20
    ? Math.round(((worstColMissingPct - 20) / 80) * 30)
    : 0;

  // Count of columns with > 20% missing
  const highMissingCols = quality.columnsWithIssues
    .filter(c => c.issue === "missing" && ((c.count ?? parseInt(c.detail)) / meta.rows) * 100 > 20)
    .length;

  const adjustedMissingScore = Math.max(0, missingScore - worstColPenalty - highMissingCols * 5);

  const constantCount  = quality.columnsWithIssues.filter(c => c.issue === "constant").length;
  const constantScore  = Math.max(0, 100 - constantCount * 15);

  // FIX: ID columns are expected in real datasets — small penalty only
  const idCount        = meta.identifierCols.length;
  const idScore        = Math.max(0, 100 - idCount * 3);

  // FIX #4: the duplicates term only participates when duplicates were actually
  // computed. Branch on the flag BEFORE any division so null never enters the
  // math (no NaN). When skipped, drop duplicates and renormalize the remaining
  // weights {0.45, 0.15, 0.15} → {0.60, 0.20, 0.20} (sum 1.0).
  let qualityComponents;
  if (quality.duplicatesComputed) {
    const dupPct   = (quality.duplicateRows / meta.rows) * 100;
    const dupScore = Math.max(0, 100 - dupPct * 50);
    qualityComponents = {
      missing:    { score: adjustedMissingScore, weight: 0.45 },
      duplicates: { score: dupScore,             weight: 0.25 },
      constant:   { score: constantScore,        weight: 0.15 },
      id:         { score: idScore,              weight: 0.15 },
    };
  } else {
    qualityComponents = {
      missing:  { score: adjustedMissingScore, weight: 0.60 },
      constant: { score: constantScore,        weight: 0.20 },
      id:       { score: idScore,              weight: 0.20 },
    };
  }
  const qualityDim = Object.values(qualityComponents)
    .reduce((sum, c) => sum + c.score * c.weight, 0);

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

  /* ── Final weighted score ── */
  let score;
  if (hasTarget) {
    score = qualityDim * 0.30 + structureDim * 0.20 + relDim * 0.20 + targetDim * 0.30;
  } else {
    // Redistribute target weight across other three
    score = qualityDim * 0.40 + structureDim * 0.30 + relDim * 0.30;
  }

  const finalScore = Math.round(Math.max(0, Math.min(100, score)));

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
    // FIX #4: auditable quality sub-components + the exact weights applied
    // (duplicates absent, weights renormalized, when the check was skipped).
    qualityBreakdown: {
      duplicatesComputed: quality.duplicatesComputed,
      components:         qualityComponents,
    },
    hasTarget,
  };
}