/* ai-eval-score.test.mjs — the eval's scoring rule, on a hand-built dossier.
   Plain Node, no framework. */

import { scoreDossier, scoreLeakage, scoreCleaning } from "../tools/ai-eval/score.mjs";

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
    // A column no expectation names: scored nowhere, so it has to be LISTED or it is invisible.
    { column: "carat", category: "derived_from_target", verdict: "unchecked" },
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
check("a finding on an unlabelled column is listed, not scored",
  ls.unchecked.length === 1 && ls.unchecked[0].column === "carat" && ls.hygiene.unchecked === 1
  && ls.total === 5 && !ls.checks.some((c) => c.name === "carat"));
check("a finding on a labelled column is never listed as unlabelled",
  !ls.unchecked.some((u) => ["total", "alive", "fare", "sex"].includes(u.column)));

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

/* ── item 28: a relevance category is not an accusation ── */
{
  const verified = {
    findings: [
      { column: "depth", category: "plausible_despite_weak_signal", verdict: "question" },
      { column: "total", category: "derived_from_target",           verdict: "confirmed" },
    ],
    split: { strategy: "random" },
    withheld: [], engineOnly: [],
  };
  const r = scoreLeakage({ leaks: { total: ["derived_from_target"] }, clean: ["depth"] }, verified);
  check("a relevance remark does not fail a labelled clean column",
        r.checks.find((c) => c.kind === "clean" && c.name === "depth").ok === true);
  check("a leak on the same answer still scores", r.checks.find((c) => c.kind === "leak").ok === true);
  check("leak and relevance findings are counted apart",
        r.hygiene.leakFindings === 1 && r.hygiene.relevanceFindings === 1);

  const r2 = scoreLeakage({ relevance: { depth: ["plausible_despite_weak_signal"] } }, verified);
  check("a relevance expectation is scored on its own axis",
        r2.checks.find((c) => c.kind === "relevance")?.ok === true);
  check("a relevance-labelled column is not listed as unlabelled",
        !r2.unchecked.some((u) => u.column === "depth"));

  const r3 = scoreLeakage({ relevance: { total: ["plausible_despite_weak_signal"] } }, verified);
  check("a leak category never satisfies a relevance expectation",
        r3.checks.find((c) => c.kind === "relevance").ok === false);
}

/* ── item 29: `sensitive`, where null is an answer ── */
{
  const dossier = (cols) => ({ columns: cols, targets: [], withheld: [], undescribed: [] });
  const verified = dossier([
    { name: "sex",    role: "binary",      subtype: "flag",     sensitive: "sex_gender", agrees: true, roleContradiction: null },
    { name: "origin", role: "categorical", subtype: "category", sensitive: null,          agrees: true, roleContradiction: null },
    { name: "color",  role: "categorical", subtype: "category", sensitive: "race_ethnicity", agrees: true, roleContradiction: null },
  ]);
  const r = scoreDossier({ sensitive: { sex: ["sex_gender"], origin: null, color: null } }, verified, null);
  const by = Object.fromEntries(r.checks.map((c) => [c.name, c]));
  check("a named sensitive attribute passes", by.sex.ok === true);
  check("a correct null passes as a real check", by.origin.ok === true);
  check("inventing an attribute for a non-person column fails", by.color.ok === false);
  check("all three are scored, none skipped", r.total === 3);
  check("flagged columns are counted for the smell test", r.hygiene.sensitiveFlagged === 2);

  const missed = scoreDossier({ sensitive: { sex: ["sex_gender"] } },
    dossier([{ name: "sex", role: "binary", subtype: "flag", sensitive: null, agrees: true, roleContradiction: null }]), null);
  check("missing a real sensitive attribute fails", missed.checks[0].ok === false);
}

console.log(failures ? `\n${failures} failure(s)` : "\nall ai-eval-score checks passed");
process.exit(failures ? 1 : 0);
