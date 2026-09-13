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
          category: { type: "string", enum: LEAK_CATEGORIES },
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
