/* Cleaning rules the engine writes itself (proposeEngineRules): only where a value's
   meaning does not depend on the file, and every one measured by the same verifier as
   a model's answer. What it must NOT touch is pinned as hard as what it must. */

import { findCleaningCandidates, proposeEngineRules, verifyCleaningRules, applyCleaningRules, cleaningRulesToPandas } from "../src/lib/ai/cleaning.js";
import { detectColumnRoles } from "../src/components/utils/core/index.js";

let failed = 0;
const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failed++;
};

const rows = Array.from({ length: 300 }, (_, i) => ({
  price:     i % 10 === 0 ? `${(i % 50) + 10} Lac` : i % 7 === 0 ? `$${(1000 + i * 13).toLocaleString("en-US")}` : String(500000 + i * 1000),
  area:      i % 6 === 0 ? `${800 + i} sqft` : String(800 + i),
  distance:  i % 6 === 0 ? `${5 + (i % 9)} m` : String(5 + (i % 9)),
  age:       i % 25 === 0 ? "-999" : String(20 + (i % 50)),
  weight:    i % 20 === 0 ? "125+" : String(60 + (i % 60)),
  furnished: i % 15 === 0 ? "semi furnished" : ["Semi-Furnished", "Furnished", "Unfurnished"][i % 3],
  share:     i % 4 === 0 ? `${i % 100}%` : String((i % 100) / 100),
  score:     i % 4 === 0 ? `${i % 100}%` : String(i % 100),
  cost:      i % 30 === 0 ? "999" : String(100 + (i * 37) % 4900),
}));
const cols = Object.keys(rows[0]);
const candidates = findCleaningCandidates(rows, cols, detectColumnRoles(rows, cols, null));
const proposal = proposeEngineRules(candidates, rows);
const { rules, withheld } = verifyCleaningRules(proposal, { data: rows, columns: cols, candidates });
const rule = (col, type) => rules.find(r => r.column === col && r.type === type);

check("a currency sign and a scale word become one unit rule with the right factors",
  JSON.stringify(rule("price", "unit_map")?.affixes) === JSON.stringify([{ affix: "$", factor: 1 }, { affix: "lac", factor: 100000 }]));
check("…and it turns the column into numbers", rule("price", "unit_map").measurement.numericShareAfter === 1);
check("a percent sign over fractions is 0.01", rule("share", "unit_map")?.affixes[0].factor === 0.01);
check("a percent sign over whole numbers is 1", rule("score", "unit_map")?.affixes[0].factor === 1);
check("a bound is read as its bound", rule("weight", "censored_numeric")?.measurement.examples[0].after === "125");
check("spellings merge into the commonest one",
  rule("furnished", "merge_levels")?.merges.some(m => m.from === "semi furnished" && m.to === "Semi-Furnished"));
check("a placeholder far outside the values is missing", rule("age", "treat_as_missing")?.values[0] === "-999");
check("a physical unit is left for the review", !rules.some(r => r.column === "area"));
check("\"m\" — metres or million — is left for the review", !rules.some(r => r.column === "distance"));
check("999 inside a column that runs to 5,000 is a value, not a placeholder", !rules.some(r => r.column === "cost"));
check("every engine rule is effective and nothing is withheld", rules.every(r => r.effective) && withheld.length === 0);

const cleaned = applyCleaningRules(rows, rules).data;
check("applied, the rules change only what they name",
  cleaned[0].price === "1000000" && cleaned[10].price === "2000000" && cleaned[0].age === "" && cleaned[6].area === rows[6].area);
const py = cleaningRulesToPandas(rules);
check("the rules export to pandas like any accepted rule", py.includes('"lac": 100000') && py.includes('"-999"'));
check("no candidates, no rules", proposeEngineRules([], rows).rules.length === 0);

if (failed) { console.error(`${failed} engine-cleaning check(s) failed`); process.exit(1); }
console.log("all engine-cleaning checks passed");
