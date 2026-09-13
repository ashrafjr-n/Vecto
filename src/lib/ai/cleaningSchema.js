/* The cleaning-proposal contract (AI phase D), shared by the Worker and the
   browser, like dossierSchema.js and leakageSchema.js. Pure data.

   The model never edits data. It proposes RULES in this closed format; the engine
   applies each one to a copy, measures what it changed, and the user decides. */

export const RULE_TYPES = [
  "unit_map",          // "42 Lac" → 4200000: a number with a unit or scale word, times a factor
  "censored_numeric",  // "125+" → 125: an open-ended value read as its bound
  "treat_as_missing",  // "-999" → missing: a placeholder, not a measurement
  "merge_levels",      // "semi furnished" → "Semi-Furnished": one category spelled two ways
];

/* Strict structured output needs one object shape, so every rule carries every
   field; the ones its type does not use are empty arrays. */
export const CLEANING_SCHEMA = {
  type: "object",
  properties: {
    rules: {
      type: "array",
      items: {
        type: "object",
        properties: {
          column: { type: "string" },
          type:   { type: "string", enum: RULE_TYPES },
          reason: { type: "string" },
          affixes: {
            type: "array",
            items: {
              type: "object",
              properties: { affix: { type: "string" }, factor: { type: "number" } },
              required: ["affix", "factor"],
              additionalProperties: false,
            },
          },
          values: { type: "array", items: { type: "string" } },
          merges: {
            type: "array",
            items: {
              type: "object",
              properties: { from: { type: "string" }, to: { type: "string" } },
              required: ["from", "to"],
              additionalProperties: false,
            },
          },
        },
        required: ["column", "type", "reason", "affixes", "values", "merges"],
        additionalProperties: false,
      },
    },
  },
  required: ["rules"],
  additionalProperties: false,
};

export const CLEANING_MAX_COLUMNS = 40;
