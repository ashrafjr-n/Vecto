/* ─────────────────────────────────────────────
   Datassert COLUMN ROLES — single source of truth
   Pure. No imports. The ONLY place role strings are
   defined as literals; every producer/consumer imports
   ROLE.* instead of re-typing the raw string.
───────────────────────────────────────────── */

export const ROLE = Object.freeze({
  IDENTIFIER:  "identifier",
  NUMERIC:     "numeric",
  BINARY:      "binary",
  CATEGORICAL: "categorical",
  TEMPORAL:    "temporal",
  /* Free text — a commentary, description or review field. Not a categorical
     variable: its "levels" are sentences, one or two rows each. Read as
     categorical, events.csv's `text` became the strongest reported association
     with the target (Cramér's V 0.78) — true, and useless, because the
     commentary describes the event it is being correlated against. */
  TEXT:        "text",
});
