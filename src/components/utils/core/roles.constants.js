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
});
