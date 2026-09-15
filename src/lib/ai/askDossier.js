/* Asking for a dossier, in as many requests as the file needs.

   A file wider than DOSSIER_PART_COLUMNS is sent in parts — see that constant for
   the measurement behind it. Each part carries only its own column profiles plus
   the names of ALL columns, so target suggestions are still made over the whole
   file. The answers are merged into the shape a single request returns, so
   verifyDossier() and every caller see one answer either way.

   Used for both the `dossier` and the `review` task. Shared by the target picker and tools/ai-eval.mjs, which pass their own `send`
   (the page's requestAi, the eval's direct call) — the eval measures the same
   splitting the user gets. */

import { DOSSIER_PART_COLUMNS } from "./dossierSchema.js";

export function splitDossierPayload(payload) {
  const { columns } = payload;
  if (columns.length <= DOSSIER_PART_COLUMNS) return [payload];
  const allColumnNames = columns.map((c) => c.name);
  const of = Math.ceil(columns.length / DOSSIER_PART_COLUMNS);
  return Array.from({ length: of }, (_, i) => ({
    ...payload,
    part: { index: i + 1, of },
    allColumnNames,
    columns: columns.slice(i * DOSSIER_PART_COLUMNS, (i + 1) * DOSSIER_PART_COLUMNS),
  }));
}

/* Columns are concatenated in order. Target candidates are interleaved by rank —
   every part's first pick, then every part's second — and de-duplicated later by
   the verifier, which keeps the first occurrence and the top 3. Cleaning rules (the
   review task) are concatenated: each part only proposes rules for its own columns. */
export function mergeDossierAnswers(answers) {
  const lists = answers.map((a) => (Array.isArray(a?.targetCandidates) ? a.targetCandidates : []));
  const longest = lists.reduce((n, l) => Math.max(n, l.length), 0);
  const targetCandidates = [];
  for (let rank = 0; rank < longest; rank++) {
    for (const list of lists) if (list[rank]) targetCandidates.push(list[rank]);
  }
  return {
    rowGrain: answers.find((a) => a?.rowGrain)?.rowGrain ?? "",
    columns: answers.flatMap((a) => (Array.isArray(a?.columns) ? a.columns : [])),
    targetCandidates,
    rules: answers.flatMap((a) => (Array.isArray(a?.rules) ? a.rules : [])),
  };
}

/* `send(partPayload)` → { result, model, error, detail, aborted }.
   Parts are sent one after another, not in parallel: the free tier allows 20
   requests a minute, and a burst of six would spend it for everyone at once.
   ponytail: a failed part fails the whole dossier; keep the finished parts if
   partial answers turn out to be worth showing. */
export async function askDossier(payload, send) {
  const answers = [];
  const models = new Set();
  for (const part of splitDossierPayload(payload)) {
    const reply = await send(part);
    if (reply.error || reply.aborted) return reply;
    answers.push(reply.result);
    if (reply.model) models.add(reply.model);
  }
  return {
    result: answers.length === 1 ? answers[0] : mergeDossierAnswers(answers),
    model: [...models].join(", ") || null,
    error: null,
    detail: null,
    aborted: false,
    parts: answers.length,
  };
}
