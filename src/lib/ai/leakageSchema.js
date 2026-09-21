/* The semantic-leakage contract (AI phase C), shared by the Worker (prompt +
   structured output) and the browser verifier — the same closed lists on both
   sides, exactly as dossierSchema.js does for phase B. Pure data. */

/* What the engine cannot see from values alone. A strong association is NOT one of
   these — a genuinely predictive feature is not leakage — which is why "none" is
   not a category: the model lists only the columns it has a concern about. */
export const LEAK_CATEGORIES = [
  "derived_from_target",     // computed from the target, or the target computed from it
  "recorded_after_outcome",  // only known once the outcome has happened
  "restates_label",          // the target under another name or encoding
  "group_leak",              // an entity key that lets a random split memorise the entity
];

/* Relevance, which is the opposite question to leakage: not "could this column not be
   used", but "does the NUMBER match what the column means" (vecto-plan item 31).

   They are kept apart from LEAK_CATEGORIES, and every consumer that asks "is this an
   accusation" asks that list — the eval's scorer most of all, where a `clean` column may
   fail only on a LEAK category. A remark that a good predictor is worth keeping must never
   be counted as a false accusation of the column it defends. */
export const RELEVANCE_CATEGORIES = [
  "plausible_despite_weak_signal",   // the engine measured little, but the column should still matter
  "implausible_despite_signal",      // the engine measured a lot, and the column has no reason to matter
];

/* Everything the model may put in `category`. LEAK_CATEGORIES stays the leak-only list. */
export const FINDING_CATEGORIES = [...LEAK_CATEGORIES, ...RELEVANCE_CATEGORIES];

/* A proposed arithmetic relationship, in a closed format the engine can evaluate —
   never code. result = op(terms):
     sum         result = t1 + t2 + …
     difference  result = t1 − t2 − …
     product     result = t1 × t2 × …
     ratio       result = t1 ÷ t2          (exactly two terms) */
export const FORMULA_OPS = ["sum", "difference", "product", "ratio"];

export const SPLIT_STRATEGIES = ["random", "grouped", "time_ordered"];

const nullableString = { type: ["string", "null"] };

export const LEAKAGE_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          column:   { type: "string" },
          category: { type: "string", enum: FINDING_CATEGORIES },
          reason:   { type: "string" },
          formula: {
            type: ["object", "null"],
            properties: {
              result: { type: "string" },
              op:     { type: "string", enum: FORMULA_OPS },
              terms:  { type: "array", items: { type: "string" } },
            },
            required: ["result", "op", "terms"],
            additionalProperties: false,
          },
        },
        required: ["column", "category", "reason", "formula"],
        additionalProperties: false,
      },
    },
    split: {
      type: "object",
      properties: {
        strategy: { type: "string", enum: SPLIT_STRATEGIES },
        column:   nullableString,
        reason:   { type: "string" },
      },
      required: ["strategy", "column", "reason"],
      additionalProperties: false,
    },
  },
  required: ["findings", "split"],
  additionalProperties: false,
};

export const LEAKAGE_MAX_COLUMNS = 150;
