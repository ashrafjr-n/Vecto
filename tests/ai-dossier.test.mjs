/* ai-dossier.test.mjs — plain Node, no framework.

   The two pure halves around the phase-B model call: what the browser SENDS
   (buildDossierPayload) and what it BELIEVES (verifyDossier). No network. */

import { buildDossierPayload, verifyDossier } from "../src/lib/ai/dossier.js";
import { detectColumnRoles } from "../src/components/utils/core/detectors/roles.js";
import { ROLE } from "../src/components/utils/core/roles.constants.js";

let failures = 0;
function check(name, ok) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}

const LONG = "a sentence that is well over forty characters long, describing the row";
const ROWS = Array.from({ length: 300 }, (_, i) => ({
  weight: i % 10 === 0 ? `${100 + (i % 3)}+` : String(50 + (i % 60)),
  region: String((i % 5) + 1),
  sex: i % 2 ? "M" : "F",
  note: `${LONG} number ${i}`,
  label: i % 3 ? "no" : "yes",
  empty: "",
}));
const COLUMNS = Object.keys(ROWS[0]);
const ROLES = detectColumnRoles(ROWS, COLUMNS, null);

console.log("PAYLOAD — what leaves the browser\n");

const payload = buildDossierPayload(ROWS, COLUMNS, ROLES);
const byName = Object.fromEntries(payload.columns.map((c) => [c.name, c]));
check("payload is deterministic", JSON.stringify(payload) === JSON.stringify(buildDossierPayload(ROWS, COLUMNS, ROLES)));
check("no row objects are sent", !JSON.stringify(payload).includes('"weight":"'));
check("free text sends no values, only its length", ROLES.note === ROLE.TEXT
  && !byName.note.examples && !byName.note.topValues && byName.note.avgLength > 40
  && !JSON.stringify(byName.note).includes("describing"));
check("examples are at most 5, each at most 60 chars + ellipsis",
  payload.columns.every((c) => !c.examples || (c.examples.length <= 5 && c.examples.every((e) => e.length <= 61))));
check("a mostly-numeric column carries its summary and the values that did not parse",
  byName.weight.summary?.min === 51 && byName.weight.nonNumericExamples?.includes("100+"));
check("low-cardinality columns carry top values with counts",
  byName.sex.topValues.length === 2 && byName.sex.topValues.every(([, n]) => n === 150));
check("an empty column reports 100% missing and no summary", byName.empty.missingPct === 100 && !byName.empty.summary);
check("the engine's target guess is NOT sent (it anchored the model)", !("engineTargetGuess" in payload));

console.log("\nVERIFY — what the browser believes\n");

const answer = {
  rowGrain: "one person",
  columns: [
    { name: "weight", meaning: "body weight class", role: "numeric", subtype: "measurement", unit: "kg",
      validRange: { min: 55, max: 200 }, confidence: "high", evidence: ['"100+" marks an open class', '"999kg" appears'] },
    { name: "region", meaning: "region code", role: "categorical", subtype: "code", unit: null,
      validRange: null, confidence: "medium", evidence: [] },
    { name: "sex", meaning: "sex", role: "numeric", subtype: "count", unit: null, validRange: null, confidence: "high", evidence: [] },
    { name: "note", meaning: "free-text note", role: "temporal", subtype: "date", unit: null, validRange: null, confidence: "low", evidence: [] },
    { name: "ghost", meaning: "made up", role: "numeric", subtype: "count", unit: null, validRange: null, confidence: "high", evidence: [] },
    { name: "label", meaning: "outcome", role: "wizard", subtype: "flag", unit: null, validRange: null, confidence: "high", evidence: [] },
    { name: "region", meaning: "duplicate", role: "numeric", subtype: "count", unit: null, validRange: null, confidence: "high", evidence: [] },
  ],
  targetCandidates: [
    { column: "label", task: "classification", reason: "a yes/no outcome" },
    { column: "empty", task: "regression", reason: "nothing" },
    { column: "nope", task: "regression", reason: "invented" },
    { column: "label", task: "classification", reason: "duplicate" },
  ],
};
const v = verifyDossier(answer, { data: ROWS, columns: COLUMNS, roles: ROLES });
const vc = Object.fromEntries(v.columns.map((c) => [c.name, c]));

check("a malformed answer is an error, not a crash", !!verifyDossier({ nope: 1 }, { data: ROWS, columns: COLUMNS, roles: ROLES }).error);
check("an unknown column is withheld with a reason", !vc.ghost && v.withheld.some((w) => w.column === "ghost"));
check("a role outside the enum is withheld", !vc.label && v.withheld.some((w) => w.column === "label" && /allowed roles/.test(w.reason)));
check("a duplicate entry keeps the first", vc.region.meaning === "region code");
check("a role the data allows is selectable (codes → categorical)",
  vc.region.engineRole === ROLE.NUMERIC && !vc.region.agrees && vc.region.roleContradiction === null);
check("a role the data contradicts is labelled (M/F → numeric)", /are numbers/.test(vc.sex.roleContradiction));
check("temporal is contradicted when values are not dates", /dates/.test(vc.note.roleContradiction));
check("a count subtype on non-integers is contradicted", !!vc.sex.subtypeContradiction);
check("the valid range is COUNTED by the engine", vc.weight.outOfRange === ROWS.filter((r) => /^\d+$/.test(r.weight) && +r.weight < 55).length);
check("an invented evidence quote is removed, a real one kept",
  vc.weight.evidence.length === 1 && vc.weight.evidence[0].startsWith('"100+"'));
check("unusable and unknown targets are withheld; duplicates dropped",
  v.targets.length === 1 && v.targets[0].column === "label"
  && v.withheld.some((w) => w.column === "empty") && v.withheld.some((w) => w.column === "nope"));
check("columns the model skipped are listed", JSON.stringify(v.undescribed) === '["empty"]');

console.log(failures ? `\n${failures} failure(s)` : "\nall ai-dossier checks passed");
process.exit(failures ? 1 : 0);
