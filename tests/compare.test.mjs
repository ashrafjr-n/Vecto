/* Train vs test (lib/compare.js): leakage between the files, schema, and shift. */

import { compareDatasets, ksTest, PSI_MAJOR } from "../src/lib/compare.js";
import { analyzeWithDiagnostic } from "../src/lib/prep/diagnostic.js";
import { generateSampleData } from "../src/components/utils/core/index.js";

let failed = 0;
const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failed++;
};

/* KS against scipy 1.x ks_2samp(a, b, method="asymp"): D exactly; the p-value within
   0.02, since this uses Stephens' small-sample correction and scipy's asymp does not. */
const a = Array.from({ length: 200 }, (_, i) => (i * 37) % 101 / 10);
const b = Array.from({ length: 150 }, (_, i) => (i * 53) % 97 / 10 + 0.8);
const ks = ksTest(a, b);
check("KS D matches scipy exactly", Math.abs(ks.d - 0.08666666666666666) < 1e-12);
check("KS p-value is within 0.02 of scipy's asymptotic one", Math.abs(ks.pValue - 0.5103633130679794) < 0.02);

const { data, columns } = generateSampleData();
const train = data.slice(0, 400);
const report = analyzeWithDiagnostic(train, columns, "churn");
const run = (testRows, testCols = columns) => compareDatasets({ rows: train, columns }, { rows: testRows, columns: testCols }, report);

/* A clean held-out split: the rest of the sample. */
const clean = run(data.slice(400, 500));
check("a clean held-out split shares no rows and no ids", clean.overlap.rows === 0 && clean.entities.find(e => e.col === "employee_id").inTrain === 0);
check("a clean split has no blocker", !clean.items.some(i => i.level === "blocker"));
check("on a random split every feature reads stable once PSI is corrected for sample size",
  clean.features.every(x => x.level === "stable") && clean.features.some(x => x.psiRaw >= 0.1));

/* Test rows copied from train. */
const leaky = run([...data.slice(400, 480), ...train.slice(0, 20)]);
check("rows copied from train are a blocker, counted exactly",
  leaky.overlap.rows === 20 && leaky.items.some(i => i.level === "blocker" && /20 test rows are also in the training file/.test(i.title)));
check("the same ids on both sides are a blocker", leaky.items.some(i => i.level === "blocker" && /"employee_id" value already in train/.test(i.title)));
check("a date column is never taken for a record id", !leaky.entities.some(e => e.col === "hire_date"));

/* Shift: salaries in another currency, a new department, missing values appear. */
const shifted = data.slice(400, 500).map((r, i) => ({
  ...r, salary: r.salary === "" ? "" : String(Number(r.salary) * 3.7), department: i % 5 === 0 ? "Legal" : r.department,
  education: i % 3 === 0 ? "" : r.education,
}));
const s = run(shifted);
const f = (col) => s.features.find(x => x.col === col);
check("a rescaled numeric column is a major shift", f("salary").level === "major" && f("salary").psi >= PSI_MAJOR && f("salary").ks > 0.5);
check("a new category is reported with its share and spelling", f("department").unseenShare >= 0.15 && f("department").unseenLevels.includes("Legal"));
check("a jump in missing values is flagged", f("education").missingShift === true);
check("an untouched column stays stable", f("age").level === "stable");
check("features come most-shifted first", s.features[0].col === "salary");

/* Schema: a column the model uses is missing; a numeric column turns to text. */
const noSalary = data.slice(400, 500).map((r) => { const out = { ...r, age: `${r.age} years` }; delete out.salary; return out; });
const sch = run(noSalary, columns.filter(c => c !== "salary"));
check("a column the model needs is missing: blocker", sch.items.some(i => i.level === "blocker" && /lacks a column the model uses/.test(i.title)));
check("numbers in train, text in test: blocker", sch.items.some(i => i.level === "blocker" && /"age"/.test(i.title)) && sch.schema.typeChanges[0].col === "age");

/* An unlabelled test file. */
const unlabelled = run(data.slice(400, 500).map(r => ({ ...r, churn: "" })));
check("a test file without labels is noted, not failed", unlabelled.target.labelled === false && unlabelled.items.some(i => i.level === "note" && /no "churn" values/.test(i.title)));

check("verdicts: leaky blocked, shifted needs care", leaky.verdict === "blocked" && s.verdict !== "ready");

if (failed) { console.error(`${failed} compare check(s) failed`); process.exit(1); }
console.log("all compare checks passed");
