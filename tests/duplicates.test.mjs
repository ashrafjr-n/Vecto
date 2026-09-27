/* Repeated records beyond exact duplicates (analyzers/duplicates.js): conflicting labels
   and the same record under a new id — and what the readiness checklist makes of them. */

import { getDuplicates } from "../src/components/utils/core/analyzers/duplicates.js";
import { analyzeDataset } from "../src/components/utils/core/index.js";
import { withDiagnostic } from "../src/lib/prep/diagnostic.js";
import { buildReadiness } from "../src/lib/readiness.js";

let failed = 0;
const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failed++;
};

const rows = [
  { id: "1", age: "30", city: "Haifa", y: "yes" },
  { id: "2", age: "30", city: "Haifa", y: "no" },    // conflicts with row 1 (ids differ, features equal)
  { id: "3", age: "41", city: "Jaffa", y: "no" },
  { id: "4", age: "41", city: "Jaffa", y: "no" },    // same record as row 3 under a new id
  { id: "3", age: "41", city: "Jaffa", y: "no" },    // exact duplicate of row 3 — Quality's, not counted here
  { id: "5", age: "50", city: "Akka",  y: "" },      // no target: ignored
  { id: "6", age: "50", city: "Akka",  y: "yes" },
];
const cols = ["id", "age", "city", "y"];
const d = getDuplicates(rows, cols, "y", ["id"]);
check("identifiers and the target are left out of the features", d.featureColumns.join() === "age,city");
check("one group of conflicting labels, two rows", d.conflicts.groups === 1 && d.conflicts.rows === 2);
check("the example names the file lines and both targets",
  d.conflicts.examples[0].lines.join() === "2,3" && d.conflicts.examples[0].targets.sort().join() === "no,yes");
check("a record repeated under a new id is counted once; the exact duplicate is not", d.idOnlyRows === 1);
check("a row with no target is ignored", d.conflicts.rows === 2);
check("without identifiers there is nothing to repeat under a new id", getDuplicates(rows, cols, "y", []).idOnlyRows === 0);
check("no target, no conflicts", getDuplicates(rows, cols, null, ["id"]).conflicts === null);
check("case and spacing of the target do not make a conflict",
  getDuplicates([{ a: "1", y: "Yes" }, { a: "1", y: " yes " }], ["a", "y"], "y").conflicts.groups === 0);

/* Exact duplicates are now counted on every file, 50,000 rows or more. */
const big = Array.from({ length: 60000 }, (_, i) => ({ k: String(i), v: String(i % 9), y: i % 2 ? "a" : "b" }));
big.push({ ...big[10] });
const bigReport = analyzeDataset(big, ["k", "v", "y"], "y");
check("a 60,000-row file has its duplicates counted", bigReport.quality.duplicatesComputed && bigReport.quality.duplicateRows === 1);

/* The readiness checklist: conflicts on 5% of rows block; a few are a fix. */
const base = Array.from({ length: 400 }, (_, i) => ({
  id: String(i), x: String((i * 7919) % 1000), g: ["a", "b", "c"][i % 3], y: (i * 7919) % 1000 > 500 !== (i % 5 === 0) ? "hi" : "lo",
}));
const withConflicts = [...base, ...base.slice(0, 30).map((r, i) => ({ ...r, id: `c${i}`, y: r.y === "hi" ? "lo" : "hi" }))];
const blocked = buildReadiness(withDiagnostic(analyzeDataset(withConflicts, ["id", "x", "g", "y"], "y"), withConflicts));
check("conflicting labels on 5% or more of rows are a blocker",
  blocked.items.some(i => i.level === "blocker" && /identical features but different targets/.test(i.title)));
const fewConflicts = [...base, { ...base[0], id: "z", y: base[0].y === "hi" ? "lo" : "hi" }];
const few = buildReadiness(withDiagnostic(analyzeDataset(fewConflicts, ["id", "x", "g", "y"], "y"), fewConflicts));
check("a few conflicting rows are a fix", few.items.some(i => i.level === "fix" && /different targets/.test(i.title)));
const copies = [...base, { ...base[3], id: "copy" }];
check("a record under a new id is a fix naming the id column",
  buildReadiness(withDiagnostic(analyzeDataset(copies, ["id", "x", "g", "y"], "y"), copies))
    .items.some(i => i.level === "fix" && /repeated under a different id/.test(i.title) && /"id"/.test(i.detail)));

if (failed) { console.error(`${failed} duplicates check(s) failed`); process.exit(1); }
console.log("all duplicates checks passed");
