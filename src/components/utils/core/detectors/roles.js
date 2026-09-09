import { isIdentifierCol, isNumeric, isMissing, normalizeValue } from "../helpers.js";
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
   Separating them needs a signal this function does not have.

   REVIEWED against a published data dictionary (events.csv ships one), which is
   the strongest evidence available for this question, and the ceiling STAYS 4.
   The dictionary proves the cost: `event_type` (12 codes), `shot_place` (13),
   `location` (19) and `assist_method` (5) are all read as measurements, so the
   report states mean(event_type) = 4.33 — the average of Announcement, Attempt,
   Corner, Foul, Yellow card. But raising the ceiling to cover them would sweep up
   ginf's `fthg`/`ftag` (goals per match, 0-10) and smoking's `amt_weekends`
   (cigarettes per day, 24 levels), which ARE counts, and strip their mean, std
   and outliers. The values still do not separate the two cases, and 9 of the
   corpus's small-integer columns split 5 codes to 4 counts — no threshold gets
   both right.

   What changed instead: quality.js now REPORTS the ambiguity on any column with
   this shape, naming the range and saying plainly that if the integers are codes
   its statistics are meaningless. That is answerable by the reader, who knows
   what the column is, and it is not a guess the engine had no basis to make. */
const ENCODED_CATEGORICAL_MAX = 4;

/* Distinct-value counting stops here. It used to be ENCODED_CATEGORICAL_MAX (4),
   because no rule cared about an exact count above that. Two rules now do — free
   text and string identifiers both turn on how much of the column is distinct —
   so the ceiling is raised to a bounded number rather than removed.

   Above the cap the count is reported as Infinity and those two rules decline to
   fire rather than guess: a column with more than CARD_CAP distinct values on a
   dataset larger than CARD_CAP/0.95 rows could be at any uniqueness ratio, and
   estimating a distinct count from a sample is the exact defect stage 3 removed.
   In practice the ceiling is only reached by very large files, where the free-text
   rule (which does not need the count) already catches the case that matters. */
const CARD_CAP = 20000;


/* A free-text column — a commentary field, a description, a review — is not a
   categorical variable: its "levels" are sentences, one or two rows each. Read as
   categorical, events.csv's `text` (941,009 rows, ~900,000 distinct) became the
   single strongest reported association with the target at V = 0.78, which is
   both true and useless: the commentary describes the event, so it restates the
   label in prose.

   Measured across the audit files, length and spacing separate it cleanly and
   nothing else comes close: `text` averages 73.8 characters with a space in 100%
   of values, while ginf's `link_odsp` (a URL) averages 62.4 characters with a
   space in 0%, and meets' `MeetName` averages 22.9. Both thresholds have to hold,
   plus more distinct values than any real category list. */
const TEXT_MIN_AVG_LENGTH = 40;
const TEXT_MIN_SPACE_SHARE = 0.5;
const TEXT_MIN_DISTINCT = 50;


/* Share of distinct values above which a non-numeric column is an identifier.
   Measured: meets' MeetPath and ginf's id_odsp/link_odsp all sit at exactly 1.000,
   while the highest non-identifier is MeetName at 0.615 — nothing in the corpus
   falls between 0.62 and 1.00, so the threshold is not near anything real. */
const IDENTIFIER_MIN_DISTINCT_SHARE = 0.95;

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
  let totalLength  = 0;
  let withSpace    = 0;

  for (let i = 0; i < data.length; i++) {
    const raw = data[i][col];
    if (isMissing(raw)) continue;
    nonMissing++;

    const numeric = isNumeric(raw);
    if (numeric) {
      numericCount++;
      if (allIntegers && !Number.isInteger(parseFloat(raw))) allIntegers = false;
    }

    /* Shape of the text itself, for the free-text rule. Both are running totals
       over the pass already being made — no second walk of the column. */
    const str = String(raw);
    totalLength += str.length;
    if (str.includes(" ")) withSpace++;

    if (!overflowed) {
      distinct.add(normalizeValue(raw));
      if (distinct.size > CARD_CAP) overflowed = true;
    }
  }

  return {
    nonMissing,
    numericCount,
    allIntegers,
    avgLength:  nonMissing > 0 ? totalLength / nonMissing : 0,
    spaceShare: nonMissing > 0 ? withSpace / nonMissing : 0,
    // Infinity = "more than CARD_CAP". Rules that need an exact ratio decline
    // rather than guess when they see it.
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

    /* Cascade position 5: free text, below numeric so a long numeric string can
       never reach it, and above plain categorical because that is the role it was
       being swept into. All three conditions must hold — length alone calls a URL
       free text, and spacing alone calls a person's name free text. */
    if (profile.avgLength >= TEXT_MIN_AVG_LENGTH
        && profile.spaceShare >= TEXT_MIN_SPACE_SHARE
        && profile.distinct > TEXT_MIN_DISTINCT) {
      roles[col] = ROLE.TEXT;
      return;
    }

    /* Cascade position 6: a column that is almost entirely distinct is an
       identifier, whatever its values look like.

       isIdentifierCol above catches identifiers by NAME (id/uuid/key/index/ref)
       and by a numeric sequence, and it reads the first 200 rows to do it — so a
       string key with no telltale name never matched. meets.csv's "MeetPath" and
       ginf.csv's "link_odsp" are one distinct value per row and came back
       CATEGORICAL, while quality.js independently labelled them "High uniqueness
       — likely an ID column". Two detectors, two answers, on the same column.

       This runs BELOW the free-text rule on purpose: at full size events.csv's
       `text` is 96% distinct and would be called an identifier by this rule alone.

       Declines when the distinct count overflowed CARD_CAP — a ratio cannot be
       estimated from a truncated count, and guessing here is the stage-3 defect. */
    if (col !== target
        && Number.isFinite(profile.distinct)
        && profile.nonMissing > 10
        && profile.distinct / profile.nonMissing > IDENTIFIER_MIN_DISTINCT_SHARE) {
      roles[col] = ROLE.IDENTIFIER;
      return;
    }

    roles[col] = ROLE.CATEGORICAL;
  });
  return roles;
}
