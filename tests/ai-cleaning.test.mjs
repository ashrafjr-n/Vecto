/* ai-cleaning.test.mjs — plain Node, no framework.

   Phase D's deterministic parts: which values the engine calls candidates, how a
   rule is applied (never in place), how a proposed rule is checked and measured
   before it is offered, and the pandas export. No network. */

import { parseAffixed, findCleaningCandidates, applyCleaningRules, verifyCleaningRules, cleaningRulesToPandas } from "../src/lib/ai/cleaning.js";
import { detectColumnRoles } from "../src/components/utils/core/detectors/roles.js";

let failures = 0;
function check(name, ok) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}

console.log("AFFIXES\n");

check("a scale word after a number", JSON.stringify(parseAffixed("1.40 Cr")) === '{"number":1.4,"affix":"cr"}');
check("a bound written as a suffix", parseAffixed("125+")?.affix === "+" && parseAffixed("125+").number === 125);
check("a unit with no space and thousands separators", parseAffixed("1,200sqft")?.number === 1200);
check("a currency symbol before a number", parseAffixed("$ 45")?.affix === "$");
check("a LETTER prefix is a code, not a unit (SI2, E0, C85, PC 17599)",
  ["SI2", "E0", "C85", "PC 17599"].every((v) => parseAffixed(v) === null));
check("a range is not a unit", parseAffixed("2,600 to 5,200") === null);

console.log("\nCANDIDATES\n");

const ROWS = Array.from({ length: 200 }, (_, i) => ({
  amount: i % 2 ? `${(i % 9) + 1} Lac` : `${(1 + (i % 5) / 10).toFixed(2)} Cr`,
  weight: i % 10 === 0 ? `${100 + (i % 3) * 5}+` : String(60 + (i % 40)),
  income: i % 25 === 0 ? "-999" : String(1000 + i * 3),
  division: ["R-JR", "R JR", "Open", "Open", "Open"][i % 5],
  price_label: i % 2 ? "85 Lac" : "8.5 Lac",
  code: `SI${(i % 2) + 1}`,
  label: i % 3 ? "no" : "yes",
}));
const COLUMNS = Object.keys(ROWS[0]);
const ROLES = detectColumnRoles(ROWS, COLUMNS, null);
const cands = findCleaningCandidates(ROWS, COLUMNS, ROLES);
const kinds = (col) => cands.find((c) => c.name === col)?.candidates.map((c) => c.kind) ?? [];

check("numbers with scale words are a numeric_affix candidate with counts and examples",
  kinds("amount").includes("numeric_affix")
  && cands.find((c) => c.name === "amount").candidates[0].affixes.every((a) => a.count === 100 && a.examples.length <= 3));
check("a mostly-numeric column with bounds is a candidate", kinds("weight").includes("numeric_affix"));
check("-999 at the edge of a numeric column is a sentinel", kinds("income").includes("sentinel"));
check("levels equal up to punctuation collide", kinds("division").includes("level_collision"));
check("a point between digits is kept: 85 Lac and 8.5 Lac do not collide", !kinds("price_label").includes("level_collision"));
check("a letter-prefixed code column is not a candidate", kinds("code").length === 0 && kinds("label").length === 0);
/* The candidates now travel on their column inside the review payload — no rows
   either way; tests/ai-review.test.mjs owns that check. */

console.log("\nAPPLY\n");

const unit = { column: "amount", type: "unit_map", affixes: [{ affix: "lac", factor: 100000 }, { affix: "cr", factor: 10000000 }], values: [], merges: [] };
const censored = { column: "weight", type: "censored_numeric", affixes: [{ affix: "+", factor: 1 }], values: [], merges: [] };
const missing = { column: "income", type: "treat_as_missing", affixes: [], values: ["-999"], merges: [] };
const merge = { column: "division", type: "merge_levels", affixes: [], values: [], merges: [{ from: "R JR", to: "R-JR" }] };
const snapshot = JSON.stringify(ROWS);
const { data: cleaned, changed } = applyCleaningRules(ROWS, [unit, censored, missing, merge]);

check("the input is never mutated", JSON.stringify(ROWS) === snapshot);
check("unit_map multiplies by the factor", cleaned[1].amount === "200000" && cleaned[0].amount === "10000000");
check("floating-point noise is tidied (1.4 × 10^7)", cleaned.find((r, i) => ROWS[i].amount === "1.40 Cr").amount === "14000000");
check("censored_numeric reads the bound", cleaned[0].weight === "100");
check("treat_as_missing empties the placeholder", cleaned[0].income === "");
check("merge_levels relabels the variant only", cleaned[1].division === "R-JR" && cleaned[0].division === "R-JR" && cleaned[2].division === "Open");
check("changed rows are counted per rule", JSON.stringify(changed) === JSON.stringify([200, 20, 8, 40]));
const mergedOnly = applyCleaningRules(ROWS, [merge]).data;
check("untouched rows are shared, not copied; changed rows are new objects", mergedOnly[2] === ROWS[2] && mergedOnly[1] !== ROWS[1]);

console.log("\nVERIFY\n");

const answer = {
  rules: [
    { column: "amount", type: "unit_map", reason: "Indian numbering", affixes: [{ affix: "Lac", factor: 100000 }, { affix: "cr", factor: 10000000 }, { affix: "k", factor: 1000 }], values: [], merges: [] },
    { column: "weight", type: "censored_numeric", reason: "open class", affixes: [{ affix: "+", factor: 1 }], values: [], merges: [] },
    { column: "income", type: "treat_as_missing", reason: "placeholder", affixes: [], values: ["-999", "-1"], merges: [] },
    { column: "division", type: "merge_levels", reason: "same division", affixes: [], values: [], merges: [{ from: "R JR", to: "R-JR" }, { from: "Open", to: "Opened" }] },
    { column: "amount", type: "unit_map", reason: "negative factor", affixes: [{ affix: "lac", factor: -1 }], values: [], merges: [] },
    { column: "label", type: "merge_levels", reason: "no-op", affixes: [], values: [], merges: [{ from: "yes", to: "yes" }] },
    { column: "ghost", type: "treat_as_missing", reason: "x", affixes: [], values: ["1"], merges: [] },
    { column: "income", type: "rewrite", reason: "x", affixes: [], values: [], merges: [] },
  ],
};
const v = verifyCleaningRules(answer, { data: ROWS, columns: COLUMNS, candidates: cands });
const rule = (col, type) => v.rules.find((r) => r.column === col && r.type === type);

check("a malformed answer is an error", !!verifyCleaningRules({}, { data: ROWS, columns: COLUMNS, candidates: cands }).error);
check("an affix the column does not contain is dropped, the rest kept (case-insensitive)",
  rule("amount", "unit_map").affixes.map((a) => a.affix).join() === "lac,cr" && v.withheld.some((w) => /"k" dropped/.test(w.reason)));
check("a unit rule is measured: every row changed and the column becomes numeric",
  rule("amount", "unit_map").measurement.rowsChanged === 200
  && rule("amount", "unit_map").measurement.numericShareBefore === 0 && rule("amount", "unit_map").measurement.numericShareAfter === 1);
check("before → after examples are recorded", rule("amount", "unit_map").measurement.examples[0].after.match(/^\d+$/));
check("a placeholder value that does not occur is dropped", rule("income", "treat_as_missing").values.join() === "-999" && v.withheld.some((w) => /"-1" dropped/.test(w.reason)));
check("a merge into a level that does not exist is dropped", rule("division", "merge_levels").merges.length === 1 && rule("division", "merge_levels").measurement.levelsAfter === 2);
check("a second rule for the same column and type keeps the first", v.rules.filter((r) => r.column === "amount").length === 1);
check("a rule that changes nothing is kept but not effective", rule("label", "merge_levels")?.effective === false);
check("unknown columns and rule types are withheld", v.withheld.some((w) => w.column === "ghost") && v.withheld.some((w) => /"rewrite"/.test(w.reason)));

console.log("\nEXPORT\n");

const pandas = cleaningRulesToPandas([unit, censored, missing, merge]);
check("the export reads text, then one block per rule",
  pandas.includes('dtype=str') && pandas.includes('# unit_map: amount') && pandas.includes('{"lac": 100000, "cr": 10000000}')
  && pandas.includes('isin(["-999"])') && pandas.includes('{"r jr": "R-JR"}'));

console.log(failures ? `\n${failures} failure(s)` : "\nall ai-cleaning checks passed");
process.exit(failures ? 1 : 0);
