/* The readiness checklist (lib/readiness.js): one verdict and a severity-ordered list,
   each item read from a finding another section already made. */

import { buildReadiness, MIN_CLASS_ROWS } from "../src/lib/readiness.js";
import { analyzeWithDiagnostic } from "../src/lib/prep/diagnostic.js";
import { analyzeDataset, generateSampleData, detectTarget } from "../src/components/utils/core/index.js";

let failed = 0;
const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failed++;
};
const TABS = new Set(["overview", "quality", "statistics", "visualizations", "targetsignal", "relationships", "classbalance", "preparation"]);
const run = (rows, target) => analyzeWithDiagnostic(rows, Object.keys(rows[0]), target);
const titles = (r) => r.items.map(i => `${i.level}:${i.title}`);

/* The sample report: a planted leak blocks it, and it comes first. */
const { data, columns } = generateSampleData();
const sample = buildReadiness(analyzeWithDiagnostic(data, columns, detectTarget(columns, data)));
check("the sample is not ready to train: a leak blocks it", sample.verdict === "blocked");
check("the leak is the first item, and names the column",
  sample.items[0].level === "blocker" && sample.items[0].title.includes('"exit_interview_score"') && sample.items[0].tab === "targetsignal");
check("the sample's duplicates, imbalance and signal are all listed",
  ["duplicate row", "Imbalanced classes", "carry signal"].every(t => sample.items.some(i => i.title.includes(t))));
check("items run blockers, then fixes, then notes",
  sample.items.map(i => ({ blocker: 0, fix: 1, note: 2 })[i.level]).every((v, i, a) => i === 0 || a[i - 1] <= v));
check("every item points at a real section or at none", sample.items.every(i => i.tab === null || TABS.has(i.tab)));

/* A clean file with a real signal: ready. One row in five is flipped — a label that is
   an exact threshold on x is a leak, and the checklist rightly says so. */
const clean = Array.from({ length: 600 }, (_, i) => {
  const x = (i * 7919) % 1000;
  return { x: String(x), g: ["a", "b", "c"][Math.floor(i / 3) % 3], z: String((i * 31) % 97), y: (x > 500) !== (i % 5 === 0) ? "hi" : "lo" };
});
const ready = buildReadiness(run(clean, "y"));
check("a clean file with signal is ready to train", ready.verdict === "ready" && !ready.items.some(i => i.level !== "note"));

check("no target asks for one", buildReadiness(analyzeDataset(clean, ["x", "g", "z", "y"], null)).verdict === "no_target");
const constant = buildReadiness(run(clean.map(r => ({ ...r, y: "same" })), "y"));
check("a constant target blocks, and says to choose another", constant.verdict === "blocked" && /same value/.test(constant.items[0].detail));

/* A class with too few rows to learn or test. */
const rare = clean.map((r, i) => ({ ...r, y: i < MIN_CLASS_ROWS - 4 ? "rare" : r.y }));
check("a class under the minimum blocks", titles(buildReadiness(run(rare, "y"))).some(t => t.startsWith("blocker:") && /fewer than/.test(t)));

/* No signal: noise against the target. */
const noise = Array.from({ length: 400 }, (_, i) => ({ a: String((i * 37) % 101), b: String((i * 53) % 89), y: i % 2 ? "p" : "q" }));
check("no signal is a fix, not a blocker", titles(buildReadiness(run(noise, "y"))).includes("fix:No reliable signal found"));

/* Too few rows. */
check("under 50 rows blocks", buildReadiness(run(clean.slice(0, 30), "y")).items.some(i => i.level === "blocker" && /Only 30 rows/.test(i.title)));

/* Personal data and an entity that repeats the target. */
const people = clean.map((r, i) => ({ ...r, email: `u${i}@example.com` }));
check("personal data is a fix", buildReadiness(run(people, "y")).items.some(i => i.level === "fix" && /Personal data in "email"/.test(i.title)));
const entity = buildReadiness({ ...run(clean, "y"), sameTargetValues: [{ column: "customer_id", values: 50, repeatedRows: 500, sameTargetShare: 0.99, overallShare: 0.5 }] });
check("an entity that repeats the target asks for a group split", entity.items.some(i => i.level === "fix" && /Rows repeat by "customer_id"/.test(i.title)));

check("no report, no checklist", buildReadiness(null) === null);

if (failed) { console.error(`${failed} readiness check(s) failed`); process.exit(1); }
console.log("all readiness checks passed");
