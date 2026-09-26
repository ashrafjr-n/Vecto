/* The sample report — the first report most visitors see. Pins that it is the same on
   every load, and that every problem planted in it is one the report actually names. */

import { generateSampleData, detectTarget } from "../src/components/utils/core/index.js";
import { analyzeWithDiagnostic } from "../src/lib/prep/diagnostic.js";
import { buildPrepPlan } from "../src/lib/prep/plan.js";

let failed = 0;
const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failed++;
};

const first = generateSampleData();
check("the sample is the same on every load", JSON.stringify(first) === JSON.stringify(generateSampleData()));

const { data, columns } = first;
const target = detectTarget(columns, data);
check("the target is detected as churn", target === "churn");

const r = analyzeWithDiagnostic(data, columns, target);
const issues = (col) => r.quality.columnsWithIssues.filter(c => c.col === col).map(c => c.issue);
check("employee_id is an identifier", r.meta.identifierCols.includes("employee_id"));
check("company is a constant column", issues("company").includes("constant"));
check("hire_date is a date", r.meta.temporalCols.includes("hire_date"));
check("salary and performance_score have missing values",
  issues("salary").includes("missing") && issues("performance_score").includes("missing"));
check("the three rows exported twice are counted as duplicates", r.quality.duplicateRows === 3);
check("exit_interview_score is flagged as target leakage",
  r.relationships.leakageSuspects.some(l => l.col === "exit_interview_score"));

const plan = buildPrepPlan(r);
check("the plan leaves out the identifier, the constant, the date and the leak",
  ["employee_id", "company", "hire_date", "exit_interview_score"].every(c => plan.excluded.some(e => e.col === c)));
check("the plan drops the duplicates before the split", plan.dropDuplicates === true);
check("the baseline finds the signal churn was generated from, without the leak",
  r.diagnostic.status === "ok" && r.diagnostic.signal === true && !r.diagnostic.nearPerfect);

if (failed) { console.error(`${failed} sample check(s) failed`); process.exit(1); }
console.log("all sample checks passed");
