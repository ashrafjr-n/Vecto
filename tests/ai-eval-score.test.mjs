/* ai-eval-score.test.mjs — the eval's scoring rule, on a hand-built dossier.
   Plain Node, no framework. */

import { scoreDossier, scoreLeakage, scoreCleaning, scorePlan } from "../tools/ai-eval/score.mjs";

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

const leakExpect = { leaks: { total: ["derived_from_target"], alive: ["restates_label"] }, clean: ["sex", "fare"], split: ["random"] };
const leakVerified = {
  findings: [
    { column: "total", category: "derived_from_target", verdict: "partial" },
    { column: "alive", category: "recorded_after_outcome", verdict: "question" },
    { column: "fare", category: "group_leak", verdict: "question" },
  ],
  split: { strategy: "grouped" },
  withheld: [{ column: "ghost" }],
  engineOnly: [],
};
const ls = scoreLeakage(leakExpect, leakVerified);
const lc = Object.fromEntries(ls.checks.map((c) => [`${c.kind}:${c.name}`, c]));
check("a leak raised in an accepted category is found", lc["leak:total"].ok);
check("a leak raised only in the wrong category is not found", !lc["leak:alive"].ok);
check("a clean column raised in ANY category fails; one never raised passes", !lc["clean:fare"].ok && lc["clean:sex"].ok);
check("a wrong split strategy fails", !lc["split:split strategy"].ok);
check("leakage hygiene counts verdicts", ls.hygiene.verdicts.partial === 1 && ls.hygiene.verdicts.question === 2 && ls.passed === 2 && ls.total === 5);

const cleanExpect = {
  rules: [
    { column: "Amount", types: ["unit_map"], factors: { lac: 100000, cr: 10000000 } },
    { column: "Area", types: ["unit_map"], ratios: [["sqyrd", "sqft", 9]] },
    { column: "Weight", types: ["censored_numeric"], affixes: ["+"] },
  ],
  forbidden: { Parking: ["unit_map"] },
};
const cleanVerified = {
  rules: [
    { column: "Amount", type: "unit_map", effective: true, affixes: [{ affix: "lac", factor: 100000 }, { affix: "cr", factor: 1000000 }] },
    { column: "Area", type: "unit_map", effective: true, affixes: [{ affix: "sqft", factor: 0.0929 }, { affix: "sqyrd", factor: 0.8361 }] },
    { column: "Weight", type: "censored_numeric", effective: false, affixes: [{ affix: "+", factor: 1 }] },
    { column: "Parking", type: "unit_map", effective: true, affixes: [{ affix: "covered", factor: 1 }] },
  ],
  withheld: [],
};
const cs = scoreCleaning(cleanExpect, cleanVerified);
const cc = Object.fromEntries(cs.checks.map((c) => [`${c.kind}:${c.name}`, c]));
check("a right factor passes and a factor off by 10x fails", cc['factor:Amount "lac"'].ok && !cc['factor:Amount "cr"'].ok);
check("a unit ladder is judged by ratio, whatever the base unit", cc['factor:Area "sqyrd"/"sqft"'].ok);
check("a rule that changes nothing does not count as proposed", !cc["rule:Weight"].ok && !cc['factor:Weight covers "+"']);
check("an effective forbidden rule fails the declined check", !cc["declined:Parking"].ok);

const planOk = scorePlan({}, { removed: [], withheld: [], notInPlan: [], summaryWords: 80, summaryTooLong: false, steps: [{}] });
const planBad = scorePlan({}, { removed: [{ number: "87" }], withheld: [], notInPlan: ["R2"], summaryWords: 200, summaryTooLong: true, steps: [] });
check("a clean plan passes all five properties; a bad one fails four", planOk.passed === 5 && planBad.passed === 1);

console.log(failures ? `\n${failures} failure(s)` : "\nall ai-eval-score checks passed");
process.exit(failures ? 1 : 0);
