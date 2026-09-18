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

/* Attributes that make a column about a PERSON in a way a model must not use
   carelessly — vecto-plan item 29. A closed list, never free text: "sensitive" as a
   free string invites the model to editorialise, and the verifier could only pass it
   through. null is a first-class answer and the common one.

   It describes what the column RECORDS, not whether using it is wrong: that is the
   user's call and the engine has no standing to make it. `financial_hardship` covers
   the means-tested proxies (a free-school-meals flag) as well as income itself,
   because a proxy carries the attribute whether or not it names it. */
export const DOSSIER_SENSITIVE = [
  "sex_gender", "race_ethnicity", "religion", "health", "sexual_orientation",
  "age", "nationality_origin", "disability", "political_opinion", "financial_hardship",
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
          /* Nullable enum, not an optional key: the strict schema requires every
             property, and "not sensitive" is an answer, not an absence. */
          sensitive: { type: ["string", "null"], enum: [...DOSSIER_SENSITIVE, null] },
          confidence: { type: "string", enum: DOSSIER_CONFIDENCE },
          evidence:   { type: "array", items: { type: "string" } },
        },
        required: ["name", "meaning", "role", "subtype", "unit", "validRange", "sensitive", "confidence", "evidence"],
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
