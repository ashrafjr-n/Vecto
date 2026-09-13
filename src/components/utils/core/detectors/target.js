import { isMissing, normalizeValue, nameTokens } from "../helpers.js";
import { detectColumnRoles } from "./roles.js";
import { ROLE } from "../roles.constants.js";

const TARGET_NAMES = new Set([
  "target", "label", "class", "outcome", "churn",
  "purchased", "survived", "default", "fraud",
  "status", "result", "y", "output",
  /* The one regression name added: price is the most common regression target in
     tabular data, and without it house_prices.csv's "Price (in rupees)" lost to
     "Status" — a column with a single real value. */
  "price",
]);

/* Words that name a target even INSIDE a longer name ("is_fraud", "price_range").
   Deliberately narrower than TARGET_NAMES: "marital_status", "passenger_class" and
   "test_result" are features, and matching "status"/"class"/"result" as a token
   made smoking.csv suggest marital_status. */
const TARGET_TOKENS = new Set(["target", "label", "outcome", "churn", "fraud", "survived", "purchased", "price"]);

/* A classification target's levels, capped: above this it reads as an identifier
   or a measurement, not a class list worth suggesting. */
const MAX_SUGGESTED_CLASSES = 20;
/* The low-cardinality rule's share, unchanged from the original detector. */
const LOW_CARDINALITY_SHARE = 0.05;

/* The guess only pre-selects a column in the picker, but a bad pre-selection is
   still the report a hurried user gets. Measured on the 10-file corpus, 6 guesses
   were wrong, and the worst were not even usable: house_prices.csv suggested
   "Status" (one value plus blanks — stage 10b now refuses it as a target) and
   the old rules never asked whether a candidate was an identifier, a date, free
   text or mostly empty. Every rule below now picks only from usable columns, and
   the roles come from detectColumnRoles — not from a second guesser. */
export function detectTarget(columns, data) {
  if (!columns.length) return undefined;
  const roles = detectColumnRoles(data, columns, null);

  // Enough distinct values to answer every rule below, and no more.
  const levelCap = Math.max(MAX_SUGGESTED_CLASSES, Math.ceil(LOW_CARDINALITY_SHARE * data.length));
  const profile = new Map(columns.map(col => {
    const levels = new Set();
    let present = 0;
    for (let i = 0; i < data.length; i++) {
      const v = data[i][col];
      if (isMissing(v)) continue;
      present++;
      if (levels.size <= levelCap) levels.add(normalizeValue(v));
    }
    return [col, { present, levels }];
  }));

  const usable = columns.filter(col => {
    const { present, levels } = profile.get(col);
    return [ROLE.BINARY, ROLE.CATEGORICAL, ROLE.NUMERIC].includes(roles[col])
      && levels.size >= 2
      && data.length > 0 && present / data.length >= 0.5;
  });
  if (!usable.length) return columns[columns.length - 1];
  const last = arr => arr[arr.length - 1];

  // 1. Name — the whole name first, then any word inside it ("is_fraud", "price_range").
  const exact = usable.find(c => TARGET_NAMES.has(String(c).toLowerCase().trim()));
  if (exact) return exact;
  const byToken = usable.filter(c => nameTokens(c).some(t => TARGET_TOKENS.has(t)));
  if (byToken.length) return last(byToken);

  // 2. The last column, when it is a plausible class list — targets tend to sit at the end.
  const lastCol = columns[columns.length - 1];
  if (usable.includes(lastCol)
      && (roles[lastCol] === ROLE.BINARY
          || (roles[lastCol] === ROLE.CATEGORICAL && profile.get(lastCol).levels.size <= MAX_SUGGESTED_CLASSES))) {
    return lastCol;
  }

  // 3. The last binary column spelled like a label (0/1, yes/no, true/false).
  const LABEL_PAIRS = [["0", "1"], ["yes", "no"], ["true", "false"]];
  const binary = usable.filter(c => {
    const lv = profile.get(c).levels;
    return lv.size === 2 && LABEL_PAIRS.some(([a, b]) => lv.has(a) && lv.has(b));
  });
  if (binary.length) return last(binary);

  // 4. Low cardinality (≤ 5% distinct), scanning from the end.
  const lowCard = [...usable].reverse().find(c => {
    const { levels } = profile.get(c);
    return levels.size <= levelCap && levels.size / data.length <= LOW_CARDINALITY_SHARE;
  });
  if (lowCard) return lowCard;

  // 5. The last usable column that is a measurement or a short class list —
  //    meets.csv otherwise fell through to MeetName, 5,154 meet names.
  const plausible = usable.filter(c => roles[c] !== ROLE.CATEGORICAL
                                    || profile.get(c).levels.size <= MAX_SUGGESTED_CLASSES);
  if (plausible.length) return last(plausible);
  // Nothing plausible at all: the coarsest usable column is the least-bad offer.
  return usable.reduce((best, c) => profile.get(c).levels.size < profile.get(best).levels.size ? c : best);
}
