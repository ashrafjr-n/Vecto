/* The one place a `sensitive` value becomes words. Two screens read it — the review
   panel on the target step and the proxy card in the report — and a second copy would
   let them disagree about what `financial_hardship` is called.

   Every entry STATES the attribute and stops. Whether a column may be used is law,
   consent and purpose, none of which are in the file, so nothing here judges. */
export const SENSITIVE_LABEL = {
  sex_gender:         "sex or gender",
  race_ethnicity:     "race or ethnicity",
  religion:           "religion",
  health:             "health",
  sexual_orientation: "sexual orientation",
  age:                "age",
  nationality_origin: "nationality or origin",
  disability:         "disability",
  political_opinion:  "political opinion",
  financial_hardship: "financial circumstances",
};

/* The columns a model flagged, in the file's own column order. Returns [] for a
   missing or unanswered dossier, so a caller can render on the length alone. */
export function flaggedColumns(dossier) {
  return (dossier?.columns ?? []).filter((c) => c.sensitive && SENSITIVE_LABEL[c.sensitive]);
}

/* ── Proxies for a flagged column (vecto-plan item 32) ────────────────────────
   Dropping a sensitive column does not remove the attribute if another column
   predicts it. Everything below READS measurements the engine already made for
   this report; nothing is computed here and nothing is asked of a model. */

export const PROXY_MIN_V = 0.3;   // the engine's own bar for reporting a categorical pair
export const PROXY_MIN_R = 0.4;   // and for a numeric pair

/* Every measured association touching `col`, strongest first. A pair is stored once
   with its two columns in file order, so both directions have to be checked. */
export function proxiesFor(col, relationships) {
  const out = [];
  for (const a of relationships?.categoricalAssociations ?? []) {
    if (a.col1 !== col && a.col2 !== col) continue;
    if (a.cramersV < PROXY_MIN_V) continue;
    out.push({ other: a.col1 === col ? a.col2 : a.col1, metric: "V", value: a.cramersV, n: a.nPairs });
  }
  for (const s of relationships?.strongRelationships ?? []) {
    if (s.col1 !== col && s.col2 !== col) continue;
    const r = Math.abs(s.correlation);
    if (r < PROXY_MIN_R) continue;
    out.push({ other: s.col1 === col ? s.col2 : s.col1, metric: "r", value: r, n: s.nPairs });
  }
  return out.sort((x, y) => y.value - x.value);
}

/* What was NOT compared, so it can be said out loud. Between FEATURES the engine
   measures numeric against numeric and categorical against categorical; a numeric
   column against a categorical one is measured only against the target. So an empty
   proxy list can mean "not measured", and printing the two the same way would turn a
   blind spot into an all-clear. Identifier, temporal and text columns are left out:
   they are outside the association scan for every column, not just this one. */
const NUMERIC_SIDE = ["numeric", "binary"];
const CATEGORICAL_SIDE = ["categorical", "binary"];

export function unmeasuredCount(col, roles) {
  const role = roles?.[col];
  if (!role) return 0;
  const scanned = (c) => NUMERIC_SIDE.includes(roles[c]) || CATEGORICAL_SIDE.includes(roles[c]);
  /* A column the association scan never looks at — an identifier, a date, free text —
     has no unmeasured PAIRS, it is unmeasured outright. Counting numeric columns as
     "not compared with it" would describe a comparison that was never on the table. */
  if (!scanned(col)) return 0;
  /* `binary` sits on both sides — it is encoded 0/1 for Pearson and counted as a level
     for Cramér's V — so nothing is ever unmeasured against it. */
  if (NUMERIC_SIDE.includes(role) && CATEGORICAL_SIDE.includes(role)) return 0;
  const sameSide = NUMERIC_SIDE.includes(role) ? NUMERIC_SIDE : CATEGORICAL_SIDE;
  return Object.keys(roles).filter(
    (c) => c !== col && scanned(c) && !sameSide.includes(roles[c])).length;
}
