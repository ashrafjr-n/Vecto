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

  // Score breakdown
  const penalties = [];

  const missingPenalty = Math.round(missingPct * 2);
  if (missingPenalty > 0) {
    penalties.push({
      label:   "Missing values",
      detail:  `${missingPct.toFixed(1)}% of cells are empty`,
      penalty: missingPenalty,
    });
  }

  // FIX #4: only penalize duplicates when they were actually computed — never let
  // null coerce to a 0 (perfect) penalty. Skipped datasets get no duplicate term.
  if (duplicatesComputed) {
    const dupPenalty = Math.round((duplicateRows / data.length) * 50);
    if (dupPenalty > 0) {
      penalties.push({
        label:   "Duplicate rows",
        detail:  `${duplicateRows} duplicate row${duplicateRows > 1 ? "s" : ""} found`,
        penalty: dupPenalty,
      });
    }
  }

  const issuePenalty = columnsWithIssues.length * 3;
  if (issuePenalty > 0) {
    penalties.push({
      label:   "Column issues",
      detail:  `${columnsWithIssues.length} column${columnsWithIssues.length > 1 ? "s" : ""} with structural issues`,
      penalty: issuePenalty,
    });
  }

  const score = Math.max(0, Math.round(100 - penalties.reduce((s, p) => s + p.penalty, 0)));

  return {
    missingCells,
    missingPct:     Math.round(missingPct * 10) / 10,
    duplicateRows,
    duplicatesComputed,
    columnsWithIssues,
    qualityScore:   score,
    scorePenalties: penalties,
    scoreBase:      100,
  };
}


/* ══════════════════════════════════════════
   HISTOGRAM HELPER — single source of truth
   FIX P7: extracted to avoid duplication
══════════════════════════════════════════ */