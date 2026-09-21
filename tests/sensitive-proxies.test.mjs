/* vecto-plan item 32 — the proxy card's logic, which is the only part of it that can
   be wrong without being visible. The rendering is not tested; these three functions
   decide WHAT it claims. */

import { flaggedColumns, proxiesFor, unmeasuredCount, PROXY_MIN_V, PROXY_MIN_R }
  from "../src/components/analyze/shared/sensitive.js";

let failed = 0;
const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failed++;
};

/* ── flaggedColumns ─────────────────────────────────────────────────────────── */
check("no dossier is no flags, never a throw", flaggedColumns(undefined).length === 0);
check("a dossier with no answer is no flags", flaggedColumns({ columns: [] }).length === 0);
check("only columns carrying a known attribute are flagged",
  flaggedColumns({ columns: [
    { name: "sex", sensitive: "sex_gender" },
    { name: "price", sensitive: null },
    /* A value off the closed list cannot reach here through the verifier, but if one
       ever did it must not render as a blank label. */
    { name: "odd", sensitive: "astrological_sign" },
  ] }).map((c) => c.name).join(",") === "sex");

/* ── proxiesFor ─────────────────────────────────────────────────────────────── */
const relationships = {
  categoricalAssociations: [
    { col1: "race", col2: "neighbourhood", cramersV: 0.71, nPairs: 900 },
    { col1: "city",  col2: "race",         cramersV: 0.42, nPairs: 880 },
    { col1: "city",  col2: "neighbourhood", cramersV: 0.95, nPairs: 900 },  // touches neither
    { col1: "race",  col2: "weak",          cramersV: 0.12, nPairs: 900 },  // under the bar
  ],
  strongRelationships: [
    { col1: "income", col2: "race", correlation: -0.55, nPairs: 800 },
    { col1: "race", col2: "tiny",   correlation: 0.10,  nPairs: 800 },      // under the bar
  ],
};
const p = proxiesFor("race", relationships);
check("a pair is found from either side", p.some((x) => x.other === "neighbourhood") && p.some((x) => x.other === "city"));
check("pairs that do not touch the column are left out", !p.some((x) => x.other === "weak" || x.other === "tiny"));
check("unrelated pairs are not returned", !p.some((x) => x.other === "race"));
check("strongest first, across both metrics",
  p.map((x) => `${x.other}:${x.metric}`).join(" ") === "neighbourhood:V income:r city:V");
check("a negative correlation is reported by magnitude",
  p.find((x) => x.other === "income").value === 0.55);
check("the bars are the engine's own", PROXY_MIN_V === 0.3 && PROXY_MIN_R === 0.4);
check("a column with nothing measured returns an empty list, not a throw",
  proxiesFor("absent", relationships).length === 0 && proxiesFor("race", {}).length === 0);

/* ── unmeasuredCount: the blind spot must be counted, or silence reads as safety ── */
const roles = {
  race: "categorical", neighbourhood: "categorical", city: "categorical",
  income: "numeric", age: "numeric",
  flagged: "binary",
  ticket: "identifier", joined: "temporal", notes: "text",
};
check("a categorical column is never compared with the numeric ones",
  unmeasuredCount("race", roles) === 2);                       // income, age
check("a numeric column is never compared with the categorical ones",
  unmeasuredCount("income", roles) === 3);                     // race, neighbourhood, city
check("binary sits on both sides, so nothing is unmeasured against it",
  unmeasuredCount("flagged", roles) === 0);
check("identifier, date and text columns are out of the scan for everyone",
  unmeasuredCount("ticket", roles) === 0 && unmeasuredCount("notes", roles) === 0);
check("an unknown column counts nothing rather than throwing",
  unmeasuredCount("nope", roles) === 0 && unmeasuredCount("race", undefined) === 0);

console.log(failed ? `\n${failed} check(s) failed` : "\nall sensitive-proxy checks passed");
process.exit(failed ? 1 : 0);
