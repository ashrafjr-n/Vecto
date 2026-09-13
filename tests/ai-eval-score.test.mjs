/* ai-eval-score.test.mjs — the eval's scoring rule, on a hand-built dossier.
   Plain Node, no framework. */

import { scoreDossier } from "../tools/ai-eval/score.mjs";

let failures = 0;
function check(name, ok) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}

const expect = { targets: ["Survived"], roles: { Pclass: ["categorical"], Fare: ["numeric"] }, subtypes: { SibSp: ["count"] } };
const verified = {
  columns: [
    { name: "Pclass", role: "categorical", subtype: "code", agrees: true, roleContradiction: null },
    { name: "SibSp", role: "categorical", subtype: "measurement", agrees: false, roleContradiction: null },
    { name: "Sex", role: "numeric", subtype: "count", agrees: false, roleContradiction: "only 0% …" },
  ],
  targets: [{ column: "Pclass" }, { column: "Survived" }],
  withheld: [{ column: "Ghost", reason: "x" }],
  undescribed: ["Fare"],
};
const s = scoreDossier(expect, verified, "Survived");
const byName = Object.fromEntries(s.checks.map((c) => [`${c.kind}:${c.name}`, c]));

check("a wrong first target fails target@1 but passes target@3",
  !byName["target@1:top suggested target"].ok && byName["target@3:any of the top 3"].ok);
check("a correct role passes", byName["role:Pclass"].ok);
check("an undescribed column fails its role check with got = null", !byName["role:Fare"].ok && byName["role:Fare"].got === null);
check("a wrong subtype fails", !byName["subtype:SibSp"].ok);
check("passed / total add up", s.passed === 2 && s.total === 5);
check("hygiene counts contradicted roles and offered changes separately",
  s.hygiene.contradictedRoles === 1 && s.hygiene.roleChangesOffered === 1 && s.hygiene.withheld === 1 && s.hygiene.undescribed === 1);
check("engine guess is judged against the same targets", s.engineTargetOk === true);
check("a file with no target scores no target checks and no engine verdict",
  scoreDossier({ roles: {} }, verified, "x").total === 0 && scoreDossier({ roles: {} }, verified, "x").engineTargetOk === null);

console.log(failures ? `\n${failures} failure(s)` : "\nall ai-eval-score checks passed");
process.exit(failures ? 1 : 0);
