import { isIdentifierCol, isNumeric, isMissing } from "../helpers.js";
import { isTemporalColumn } from "./temporal.js";
import { ROLE } from "../roles.constants.js";

/* Integer columns at or below this many distinct values are read as encoded
   categoricals (country_code 1..4) rather than measurements.

   This is 4, not the 8 the old comment claimed. The old rule was
   `uniqueNum <= 8 && uniqueNum / numSample.length < 0.05` over a 100-row head
   sample — and since that sample caps at 100, the ratio clause alone forced
   uniqueNum < 5 for every dataset with 100+ non-missing rows. The `<= 8` half
   had been dead for the entire life of the file. 4 is therefore the behavior
   that actually shipped and that the reference fixtures were built against;
   making it a literal 4 changes no column at realistic size, it just stops the
   code from claiming something it never did.

   Deliberate ceiling: 5-8 distinct integers stay NUMERIC. A count feature
   (SibSp 0-8) and an encoded code (region 1..8) are indistinguishable from the
   values alone, and calling a count categorical costs it its mean/std/outliers.
   Separating them needs a signal this function does not have. */
const ENCODED_CATEGORICAL_MAX = 4;

/* Distinct-value counting stops here — no rule below cares about an exact count
   above ENCODED_CATEGORICAL_MAX, so the Set stays O(1) instead of growing to one
   entry per row on a high-cardinality column. */
const CARD_CAP = ENCODED_CATEGORICAL_MAX;

/* One full-column pass: cardinality, numeric share, and integrality.

   Cardinality is measured over the WHOLE column, never a head sample. That was
   the bug: the old code compared a distinct count against the size of a 100-row
   head, so the SAME column changed role as the dataset grew — Pclass came back
   NUMERIC at n<=60 and CATEGORICAL at n>=80, and a 0/1 flag came back NUMERIC at
   n=40 and CATEGORICAL at n=60. A distinct count is not a proportion and cannot
   be estimated from a sample. (A proportion can be, which is why the temporal
   check below still takes a sample — that rule is a 90% share, not a count.)

   Values are normalized once, here: numeric-looking values by their parsed value
   so "1", "1.0" and " 1 " are one level, everything else lowercased and trimmed. */
function profileColumn(data, col) {
  const distinct = new Set();
  let overflowed   = false;
  let nonMissing   = 0;
  let numericCount = 0;
  let allIntegers  = true;

  for (let i = 0; i < data.length; i++) {
    const raw = data[i][col];
    if (isMissing(raw)) continue;
    nonMissing++;

    const numeric = isNumeric(raw);
    if (numeric) {
      numericCount++;
      if (allIntegers && !Number.isInteger(parseFloat(raw))) allIntegers = false;
    }

    if (!overflowed) {
      distinct.add(numeric ? String(parseFloat(raw)) : String(raw).toLowerCase().trim());
      if (distinct.size > CARD_CAP) overflowed = true;
    }
  }

  return {
    nonMissing,
    numericCount,
    allIntegers,
    // Infinity = "more than CARD_CAP"; the exact figure is never needed.
    distinct: overflowed ? Infinity : distinct.size,
  };
}

export function detectColumnRoles(data, columns, target) {
  const roles = {};
  columns.forEach(col => {
    // Never short-circuit for target — we need its real role
    if (isIdentifierCol(data, col) && col !== target) {
      roles[col] = ROLE.IDENTIFIER;
      return;
    }

    const profile = profileColumn(data, col);
    if (profile.nonMissing === 0) {
      roles[col] = ROLE.CATEGORICAL;
      return;
    }

    // Cascade position 2: temporal — BEFORE numeric/categorical so date strings get
    // ROLE.TEMPORAL instead of being swept into high-cardinality categorical (or a
    // numeric-parseable date into numeric). Precision-gated: ≥90% valid dates of one
    // family. Bare years/epoch have no date structure → fall through to numeric.
    // A 90% share IS estimable from a head sample, unlike a distinct count.
    const sample = data.slice(0, 100).map(r => r[col]).filter(v => !isMissing(v));
    if (sample.length > 0 && isTemporalColumn(sample)) {
      roles[col] = ROLE.TEMPORAL;
      return;
    }

    // Cascade position 3: exactly two levels is the definition of binary, whatever
    // those levels look like. This used to sit at the very bottom, reachable only
    // by text pairs (yes/no, male/female): a numeric 0/1 column was claimed by the
    // encoded-categorical branch above it, so ROLE.BINARY was unreachable for the
    // most common binary encoding there is. BINARY and CATEGORICAL both feed
    // meta.categoricalCols, so this renames the role without rerouting the column.
    if (profile.distinct === 2) {
      roles[col] = ROLE.BINARY;
      return;
    }

    if (profile.numericCount / profile.nonMissing >= 0.8) {
      const isEncoded = profile.allIntegers && profile.distinct <= ENCODED_CATEGORICAL_MAX;
      roles[col] = isEncoded ? ROLE.CATEGORICAL : ROLE.NUMERIC;
      return;
    }

    roles[col] = ROLE.CATEGORICAL;
  });
  return roles;
}
