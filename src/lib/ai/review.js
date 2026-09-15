/* Column review (B+D merged) — the dossier and the cleaning proposal from one request.

   Nothing new is measured here: the payload is the dossier profile with the engine's
   cleaning candidates attached to their own column, and the answer is checked by the
   two verifiers the separate tasks already use. Attaching candidates to the column
   (not a second list) means splitting a wide file into parts keeps each column's
   candidates with it for free. */

import { buildDossierPayload, verifyDossier } from "./dossier.js";
import { verifyCleaningRules } from "./cleaning.js";

/* `candidates` is findCleaningCandidates() output for the SAME file, as uploaded. */
export function buildReviewPayload(data, columns, roles, candidates) {
  const payload = buildDossierPayload(data, columns, roles);
  const byName = new Map(candidates.map((c) => [c.name, c.candidates]));
  for (const col of payload.columns) {
    if (byName.has(col.name)) col.cleaning = byName.get(col.name);
  }
  return payload;
}

/* → { dossier, cleaning } — each exactly what its own verifier returns — or { error }. */
export function verifyReview(answer, { data, columns, roles, candidates }) {
  const dossier = verifyDossier(answer, { data, columns, roles });
  const cleaning = verifyCleaningRules(answer, { data, columns, candidates });
  const error = dossier.error ?? cleaning.error;
  return error ? { error } : { dossier, cleaning };
}
