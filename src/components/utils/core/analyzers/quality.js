import { isMissing, isNumeric, toNumber } from "../helpers.js";

/* The share of present values that must parse as numbers before a column is
   analysed as numeric — the same 0.8 relations.js gates on. Above it, every
   value that is NOT a number is dropped from every statistic in the report. */
const NUMERIC_SHARE = 0.8;

/* A column of small, gapless integers is either a set of codes or a count, and
   the values alone cannot say which — see the ENCODED_CATEGORICAL_MAX note in
   detectors/roles.js, which reviewed the question against a published data
   dictionary and left the ceiling where it was. What the engine CAN do is say so.

   Bounds chosen from the corpus: below 5 distinct the role detector already reads
   the column as categorical, and above 25 a gapless run from 0 or 1 is far more
   likely to be a genuine count or an index than a code list. The gapless-from-the-
   origin test is what keeps the noise down — it drops smoking's `amt_weekends`
   (24 levels scattered over 0-60) and ginf's `season` (2012-2017), while keeping
   every coded column in events.csv. */
const CODE_MIN_DISTINCT = 5;
const CODE_MAX_DISTINCT = 25;

export function getQuality(data, columns, identifierCols = [], temporalCols = [], textCols = []) {
  let missingCells = 0;
  const columnsWithIssues = [];

  columns.forEach(col => {
    const vals    = data.map(r => r[col]);
    const missing = vals.filter(v => isMissing(v)).length;
    const nonEmpty = vals.filter(v => !isMissing(v));
    const unique  = [...new Set(nonEmpty)];

    missingCells += missing;

    // FIX #3: Check missing and constant independently (not mutually exclusive)
    if (missing > 0) {
      columnsWithIssues.push({
        col,
        issue:  "missing",
        count:  missing,                                       // FIX #3: store raw count
        detail: `${missing} missing value${missing > 1 ? "s" : ""}`,
      });
    }

    /* Values thrown away to treat this column as numeric.

       A column that is 93% numbers is still ANALYSED as numeric — dropping a real
       column over a handful of dirty cells would be worse — but the values that
       had to be discarded to do that are a fact about the data, and until now no
       part of the report mentioned them. openpowerlifting.csv "WeightClassKg"
       holds 25,813 super-heavyweight classes written "125+" / "120+" / "84+";
       every mean, median, histogram and correlation in the report is computed
       without them, and the user was never told which rows went missing. */
    if (nonEmpty.length > 0) {
      const nonNumeric = nonEmpty.filter(v => !isNumeric(v));
      if (nonNumeric.length > 0 && (nonEmpty.length - nonNumeric.length) / nonEmpty.length > NUMERIC_SHARE) {
        const examples = [...new Set(nonNumeric.map(String))].slice(0, 3);
        columnsWithIssues.push({
          col,
          issue:  "mixed_numeric",
          count:  nonNumeric.length,
          detail: `${nonNumeric.length} value${nonNumeric.length > 1 ? "s are" : " is"} not a number `
                + `(e.g. ${examples.map(e => `"${e}"`).join(", ")}) — excluded from every statistic for this column`,
        });
      }
    }

    /* Integers that may be codes rather than measurements. Gated on the distinct
       count that is already in hand, so the parsing pass below runs only for the
       handful of columns with the right shape. */
    if (unique.length >= CODE_MIN_DISTINCT && unique.length <= CODE_MAX_DISTINCT) {
      let allInt = true, min = Infinity, max = -Infinity;
      const ints = new Set();
      for (const v of nonEmpty) {
        const n = toNumber(v);
        if (!Number.isInteger(n)) { allInt = false; break; }
        ints.add(n);
        if (n < min) min = n;
        if (n > max) max = n;
      }
      // Gapless run from 0 or 1: every value between the ends is present.
      if (allInt && (min === 0 || min === 1) && ints.size === max - min + 1) {
        columnsWithIssues.push({
          col,
          issue:  "possible_code",
          count:  ints.size,
          detail: `${ints.size} integers from ${min} to ${max} with no gaps — if these are codes rather than a count, `
                + `the mean, median and histogram reported for "${col}" describe nothing. The values alone cannot tell the two apart.`,
        });
      }
    }

    // Only check constant/cardinality on non-empty values
    if (nonEmpty.length > 0) {
      if (unique.length === 1) {
        columnsWithIssues.push({
          col,
          issue:  "constant",
          detail: `All non-empty values are identical ("${unique[0]}")`,
        });
      // FIX: compare against nonEmpty.length so missing rows don't mask full uniqueness
      // FIX: use ratio > 0.95 instead of === to catch near-unique columns
      } else if (
        !identifierCols.includes(col) &&
        !temporalCols.includes(col) &&        // dates are all-unique but not "likely an ID"
        !textCols.includes(col) &&            // nor is a commentary field, for the same reason
        (unique.length / nonEmpty.length) > 0.95 &&
        nonEmpty.length > 10
      ) {
        columnsWithIssues.push({
          col,
          issue:  "high_cardinality",
          detail: "High uniqueness — likely an ID column",
        });
      }
    }
  });

  // FIX P6: skip duplicate detection for large datasets (expensive O(n × cols log cols))
  // FIX #4: "skipped" ≠ "zero". Represent not-computed as null + a duplicatesComputed
  // flag, so 0 unambiguously means "checked, none found".
  const duplicatesComputed = data.length <= 50000;
  let duplicateRows = null;
  if (duplicatesComputed) {
    const serialized = data.map(r => JSON.stringify(r, Object.keys(r).sort()));
    duplicateRows    = serialized.length - new Set(serialized).size;
  }
  const missingPct    = (missingCells / (data.length * columns.length)) * 100;

  /* ── The quality score ────────────────────────────────────────────────────
     There were TWO of these. This file computed a flat 100 minus penalties, and
     health.js computed a weighted average of four component scores from these
     same outputs — different models, both called "quality", and they disagreed
     openly: openpowerlifting.csv scored 11 here and 40 there, events.csv 7 and 39.

     The flat model is the one that goes. It double-counted (a mostly-empty column
     was charged once through missingPct and again through the column-issue count)
     and the issue count was unbounded, so adding a new KIND of issue silently
     moved every dataset's score — which is exactly what happened when
     `mixed_numeric` and `possible_code` were added. The weighted model is bounded
     per component and says what each part contributed.

     The presentation is unchanged: a weighted average IS a base minus deductions,
     since 100 − Σ wᵢ(100 − sᵢ) = Σ wᵢsᵢ. So `scorePenalties` still reads as a
     waterfall from 100, each row now naming the component and its weight. */
  const pct = (n, d) => (d > 0 ? (n / d) * 100 : 0);

  /* Overall emptiness, then an extra charge for the WORST single column: a file
     that is 5% empty overall because one column is 90% empty is not the same
     dataset as one where every column is 5% short. */
  let worstColMissingPct = 0;
  let worstMissingCol    = null;
  let highMissingCols    = 0;
  for (const c of columnsWithIssues) {
    if (c.issue !== "missing") continue;
    const p = pct(c.count ?? 0, data.length);
    if (p > 20) highMissingCols++;
    if (p > worstColMissingPct) { worstColMissingPct = p; worstMissingCol = c.col; }
  }
  const worstColPenalty = worstColMissingPct > 20
    ? Math.round(((worstColMissingPct - 20) / 80) * 30)
    : 0;

  const missingScore  = Math.max(0, 100 - missingPct * 2 - worstColPenalty - highMissingCols * 5);
  const constantCols  = columnsWithIssues.filter(c => c.issue === "constant").length;
  const constantScore = Math.max(0, 100 - constantCols * 15);
  // Identifiers are expected in real data — a small charge, not a defect.
  const idScore       = Math.max(0, 100 - identifierCols.length * 3);

  /* The duplicates term participates only when duplicates were actually counted.
     When the check is skipped its weight is redistributed across the other three
     rather than scored as a perfect 100 — "not measured" must never read as
     "measured, and clean". */
  const components = duplicatesComputed
    ? {
        missing:    { score: missingScore,  weight: 0.45, detail: `${missingPct.toFixed(1)}% of cells empty${worstMissingCol ? `, worst column "${worstMissingCol}" at ${worstColMissingPct.toFixed(1)}%` : ""}` },
        duplicates: { score: Math.max(0, 100 - pct(duplicateRows, data.length) * 50), weight: 0.25, detail: `${duplicateRows} duplicate row${duplicateRows === 1 ? "" : "s"}` },
        constant:   { score: constantScore, weight: 0.15, detail: `${constantCols} constant column${constantCols === 1 ? "" : "s"}` },
        id:         { score: idScore,       weight: 0.15, detail: `${identifierCols.length} identifier column${identifierCols.length === 1 ? "" : "s"}` },
      }
    : {
        missing:  { score: missingScore,  weight: 0.60, detail: `${missingPct.toFixed(1)}% of cells empty${worstMissingCol ? `, worst column "${worstMissingCol}" at ${worstColMissingPct.toFixed(1)}%` : ""}` },
        constant: { score: constantScore, weight: 0.20, detail: `${constantCols} constant column${constantCols === 1 ? "" : "s"}` },
        id:       { score: idScore,       weight: 0.20, detail: `${identifierCols.length} identifier column${identifierCols.length === 1 ? "" : "s"}` },
      };

  const LABEL = { missing: "Missing values", duplicates: "Duplicate rows", constant: "Constant columns", id: "Identifier columns" };
  const penalties = Object.entries(components)
    .map(([key, c]) => ({
      label:   LABEL[key],
      detail:  `${c.detail} · ${Math.round(c.weight * 100)}% of the quality score`,
      penalty: Math.round(c.weight * (100 - c.score)),
    }))
    .filter(p => p.penalty > 0);

  const score = Math.max(0, Math.round(
    Object.values(components).reduce((sum, c) => sum + c.score * c.weight, 0),
  ));

  return {
    missingCells,
    missingPct:     Math.round(missingPct * 10) / 10,
    duplicateRows,
    duplicatesComputed,
    columnsWithIssues,
    qualityScore:   score,
    qualityComponents: components,
    /* The single worst-affected column, computed once here for the missing-value
       component and read by health.js for its score cap — which used to walk
       columnsWithIssues again to find the same column. */
    worstMissingColumn: worstMissingCol
      ? { col: worstMissingCol, pct: Math.round(worstColMissingPct * 10) / 10 }
      : null,
    scorePenalties: penalties,
    scoreBase:      100,
  };
}


/* ══════════════════════════════════════════
   HISTOGRAM HELPER — single source of truth
   FIX P7: extracted to avoid duplication
══════════════════════════════════════════ */