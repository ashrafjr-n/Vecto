/* ai-review.test.mjs — plain Node, no framework.

   The merged column review (B+D): the payload is the dossier profile with each
   column's cleaning candidates attached, wide files keep candidates with their
   column when split, parts' rules are merged, and the answer is checked by both
   existing verifiers. No network. */

import { buildReviewPayload, verifyReview } from "../src/lib/ai/review.js";
import { buildDossierPayload } from "../src/lib/ai/dossier.js";
import { findCleaningCandidates } from "../src/lib/ai/cleaning.js";
import { splitDossierPayload, askDossier } from "../src/lib/ai/askDossier.js";
import { detectColumnRoles } from "../src/components/utils/core/detectors/roles.js";

let failures = 0;
function check(name, ok) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}

const ROWS = Array.from({ length: 200 }, (_, i) => ({
  amount: i % 2 ? `${(i % 9) + 1} Lac` : `${(1 + (i % 5) / 10).toFixed(2)} Cr`,
  division: ["R-JR", "R JR", "Open", "Open", "Open"][i % 5],
  label: i % 3 ? "no" : "yes",
}));
const COLUMNS = Object.keys(ROWS[0]);
const ROLES = detectColumnRoles(ROWS, COLUMNS, null);
const CANDIDATES = findCleaningCandidates(ROWS, COLUMNS, ROLES);

console.log("PAYLOAD\n");

const payload = buildReviewPayload(ROWS, COLUMNS, ROLES, CANDIDATES);
const col = (name) => payload.columns.find((c) => c.name === name);
check("candidates ride on their own column", col("amount").cleaning?.[0].kind === "numeric_affix" && col("division").cleaning?.[0].kind === "level_collision");
check("a column with no candidates carries no cleaning field", !("cleaning" in col("label")));
const withoutCleaning = payload.columns.map((c) => Object.fromEntries(Object.entries(c).filter(([k]) => k !== "cleaning")));
check("apart from that field it is the dossier payload, byte for byte",
  JSON.stringify({ ...payload, columns: withoutCleaning }) === JSON.stringify(buildDossierPayload(ROWS, COLUMNS, ROLES)));
check("no candidates at all is the dossier payload unchanged",
  JSON.stringify(buildReviewPayload(ROWS, COLUMNS, ROLES, [])) === JSON.stringify(buildDossierPayload(ROWS, COLUMNS, ROLES)));
check("deterministic", JSON.stringify(payload) === JSON.stringify(buildReviewPayload(ROWS, COLUMNS, ROLES, CANDIDATES)));

console.log("\nPARTS\n");

const wide = { schemaVersion: 1, rows: 10, columns: Array.from({ length: 30 }, (_, i) => ({ name: `c${i}`, ...(i === 27 ? { cleaning: [{ kind: "sentinel" }] } : {}) })) };
const parts = splitDossierPayload(wide);
check("a column's candidates travel in the part that describes it", parts[1].columns.some((c) => c.name === "c27" && c.cleaning) && !parts[0].columns.some((c) => c.cleaning));
const asked = await askDossier(wide, async (p) => ({
  result: { rowGrain: "x", columns: p.columns, targetCandidates: [], rules: p.columns.filter((c) => c.cleaning).map((c) => ({ column: c.name })) },
  model: "m",
}));
check("rules from every part are merged", asked.result.rules.length === 1 && asked.result.rules[0].column === "c27");

console.log("\nVERIFY\n");

const answer = {
  rules: [
    { column: "amount", type: "unit_map", reason: "Indian numbering", affixes: [{ affix: "lac", factor: 100000 }, { affix: "cr", factor: 10000000 }], values: [], merges: [] },
    { column: "ghost", type: "treat_as_missing", reason: "x", affixes: [], values: ["1"], merges: [] },
  ],
  rowGrain: "one listing",
  columns: [
    { name: "amount", meaning: "price", role: "numeric", subtype: "measurement", unit: "INR", validRange: null, confidence: "high", evidence: [] },
    { name: "ghost", meaning: "x", role: "numeric", subtype: "count", unit: null, validRange: null, confidence: "high", evidence: [] },
  ],
  targetCandidates: [{ column: "label", task: "classification", reason: "outcome" }],
};
const v = verifyReview(answer, { data: ROWS, columns: COLUMNS, roles: ROLES, candidates: CANDIDATES });
check("both halves are verified by their own verifier",
  v.dossier.columns.length === 1 && v.dossier.targets[0].column === "label"
  && v.cleaning.rules.length === 1 && v.cleaning.rules[0].measurement.rowsChanged === 200);
check("each half keeps its own withheld list", v.dossier.withheld.some((w) => w.column === "ghost") && v.cleaning.withheld.some((w) => w.column === "ghost"));
check("a missing rules section is an error, not a half answer",
  !!verifyReview({ ...answer, rules: undefined }, { data: ROWS, columns: COLUMNS, roles: ROLES, candidates: CANDIDATES }).error);
check("a missing columns section is an error",
  !!verifyReview({ ...answer, columns: undefined }, { data: ROWS, columns: COLUMNS, roles: ROLES, candidates: CANDIDATES }).error);

console.log(failures ? `\n${failures} failure(s)` : "\nall ai-review checks passed");
process.exit(failures ? 1 : 0);
