/* The column-review contract (B+D merged): the dossier and the cleaning rules in ONE
   answer, shared by the Worker and the browser like the two contracts it is built
   from. Their closed lists and item shapes are reused, not copied, so a subtype or
   rule type added there is accepted here too.

   `rules` comes FIRST: a model writes properties in schema order, so the short
   rules section is finished before the long per-column section starts. */

import { DOSSIER_SCHEMA } from "./dossierSchema.js";
import { CLEANING_SCHEMA } from "./cleaningSchema.js";

export const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    rules: CLEANING_SCHEMA.properties.rules,
    ...DOSSIER_SCHEMA.properties,
  },
  required: ["rules", ...DOSSIER_SCHEMA.required],
  additionalProperties: false,
};
