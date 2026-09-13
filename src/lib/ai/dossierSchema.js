/* The column-dossier contract, shared by the Worker (which asks the model for it)
   and the browser (which verifies what came back). One file, so the closed lists
   the model is told to use are exactly the lists the verifier accepts.

   Pure data, no imports beyond the ROLE enum. */

import { ROLE } from "../../components/utils/core/roles.constants.js";

export const DOSSIER_ROLES = Object.values(ROLE);

/* Finer than a role, and the part the engine cannot see from values alone: a
   count and an encoded code are both small integers (see ENCODED_CATEGORICAL_MAX
   in roles.js), a foreign key and a measurement are both repeated numbers. */
export const DOSSIER_SUBTYPES = [
  "measurement", "count", "code", "identifier", "foreign_key", "entity_name",
  "category", "flag", "date", "free_text", "other",
];

export const DOSSIER_CONFIDENCE = ["low", "medium", "high"];
export const DOSSIER_TASKS = ["classification", "regression"];

const nullable = (type) => ({ type: [type, "null"] });

/* Strict structured-output schema: every property required, no extras. Optional
   facts are expressed as null, never as an absent key. */
export const DOSSIER_SCHEMA = {
  type: "object",
  properties: {
    rowGrain: { type: "string" },
    columns: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name:       { type: "string" },
          meaning:    { type: "string" },
          role:       { type: "string", enum: DOSSIER_ROLES },
          subtype:    { type: "string", enum: DOSSIER_SUBTYPES },
          unit:       nullable("string"),
          validRange: {
            type: ["object", "null"],
            properties: { min: nullable("number"), max: nullable("number") },
            required: ["min", "max"],
            additionalProperties: false,
          },
          confidence: { type: "string", enum: DOSSIER_CONFIDENCE },
          evidence:   { type: "array", items: { type: "string" } },
        },
        required: ["name", "meaning", "role", "subtype", "unit", "validRange", "confidence", "evidence"],
        additionalProperties: false,
      },
    },
    targetCandidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          column: { type: "string" },
          task:   { type: "string", enum: DOSSIER_TASKS },
          reason: { type: "string" },
        },
        required: ["column", "task", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["rowGrain", "columns", "targetCandidates"],
  additionalProperties: false,
};

/* Upper bound on columns per file (at most 6 parts). */
export const DOSSIER_MAX_COLUMNS = 150;

/* Columns per request. Measured 2026-09-14: on sonar (61 columns) BOTH nemotron
   models returned exactly 32 entries with finish_reason "stop" at ~2.4–5k output
   tokens — not a token limit, and unchanged by telling the model the count. A
   wider file is sent in parts of this size; a file at or under it is one request
   with an unchanged payload. */
export const DOSSIER_PART_COLUMNS = 25;
