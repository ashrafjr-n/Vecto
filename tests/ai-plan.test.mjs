/* ai-plan.test.mjs — plain Node, no framework.

   Phase E's pure halves: what the plan request sends, and how the answer is held
   to the report — real recommendation ids, no number the report does not contain,
   no high-priority item quietly left out. No network. */

import { analyzeDataset, generateSampleData } from "../src/components/utils/core/index.js";
import { buildPlanPayload, verifyPlan, numbersIn } from "../src/lib/ai/plan.js";

let failures = 0;
function check(name, ok) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}

const { data, columns } = generateSampleData();
const result = analyzeDataset(data, columns, "churn");
const payload = buildPlanPayload(result, {
  cleaningRules: [{ column: "salary", type: "treat_as_missing" }],
  leakageReview: { findings: [{ column: "employee_id", category: "group_leak", verdict: "question" }] },
});

console.log("PAYLOAD\n");
check("every recommendation gets a stable id in report order",
  payload.recommendations.length === result.recommendations.length && payload.recommendations[0].id === "R1");
check("the health score and the reasons that capped it travel", payload.health.score === result.healthScore.score && Array.isArray(payload.health.limits));
check("the user's decisions are included", payload.decisions.cleaningRules[0] === "salary: treat_as_missing" && /group_leak/.test(payload.decisions.leakageReview[0]));
check("no rows are sent", !JSON.stringify(payload).includes('"department":"'));

console.log("\nNUMBERS\n");
check("numbers are read as written, names are not numbers",
  JSON.stringify(numbersIn("R3 has 2,873 rows at 77.1% and fc_2 is -0.54").map((n) => n.value)) === "[2873,77.1,-0.54]");

console.log("\nVERIFY\n");
const high = payload.recommendations.filter((r) => r.priority === "high").map((r) => r.id);
const score = result.healthScore.score;
const answer = {
  summary: `The dataset scores ${score} out of 100. Your data has 987654.3 clean cells. Fix the high-priority items first.`,
  steps: [
    { title: "Drop identifiers", why: "They name rows instead of describing them.", recommendationIds: [high[0], "R999"] },
    { title: "Invented step", why: "Nothing real.", recommendationIds: ["R999"] },
    { title: "Handle imbalance at 42.42%", why: `Class weights help. The majority is ${result.classBalance.classes[0].pct}%.`, recommendationIds: payload.recommendations.slice(1, 2).map((r) => r.id) },
  ],
};
const v = verifyPlan(answer, payload);

check("a malformed answer is an error", !!verifyPlan({ steps: "x" }, payload).error);
check("a sentence with a number from the report is kept", v.summary.includes(`scores ${score} out of 100`));
check("a sentence with an invented number is removed and listed", !v.summary.includes("987654.3") && v.removed.some((r) => r.number === "987654.3"));
check("a sentence without numbers is kept", v.summary.includes("Fix the high-priority items first."));
check("unknown ids are dropped from a step and noted", v.steps[0].recommendationIds.join() === high[0] && v.withheld.some((w) => /R999/.test(w.reason)));
check("a step referencing nothing real is dropped", !v.steps.some((s) => s.title === "Invented step"));
check("a title with an invented number falls back to the recommendation's issue",
  v.steps[1].title === result.recommendations[1].issue);
check("a percentage from the report is grounded", v.steps[1].why.includes("The majority is"));
check("high-priority recommendations left out of the plan are listed",
  JSON.stringify(v.notInPlan) === JSON.stringify(high.filter((id) => id !== high[0] && id !== payload.recommendations[1].id)));
check("a share written as a percentage is grounded (0.958 → 95.8)",
  verifyPlan({ summary: "It rose to 95.8% after cleaning.", steps: [] }, { ...payload, extra: 0.958 }).summary.includes("95.8%"));

console.log(failures ? `\n${failures} failure(s)` : "\nall ai-plan checks passed");
process.exit(failures ? 1 : 0);
