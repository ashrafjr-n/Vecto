/* vecto-plan item 35 — the preparation pipeline. What is locked here is what can be
   wrong without being visible: which rows are held out, that nothing is learned
   from them, and that the plan makes the same decisions the report's advice does. */

import { assignFolds } from "../src/lib/prep/folds.js";
import { usableRows, encodeTarget, fitPrep, transformRows, MAX_CATEGORIES } from "../src/lib/prep/encode.js";
import { buildPrepPlan } from "../src/lib/prep/plan.js";
import { prepPlanToSklearn } from "../src/lib/prep/sklearn.js";
import { analyzeDataset } from "../src/components/utils/core/index.js";

let failed = 0;
const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failed++;
};
const sizes = (folds, k) => Array.from({ length: k }, (_, f) => folds.filter(x => x === f).length);

/* ── assignFolds ────────────────────────────────────────────────────────────── */
const plain = assignFolds(1003, 5);
check("the same input gives the same folds on every run",
  plain.join() === assignFolds(1003, 5).join() && plain.join() !== assignFolds(1003, 5, { seed: 7 }).join());
check("fold sizes differ by at most one row",
  Math.max(...sizes(plain, 5)) - Math.min(...sizes(plain, 5)) <= 1);

const cls = Array.from({ length: 1000 }, (_, i) => (i % 10 === 0 ? "rare" : "common"));
const strat = assignFolds(1000, 5, { strata: i => cls[i] });
check("stratified folds keep the class shares (100 rare rows → 20 per fold)",
  Array.from({ length: 5 }, (_, f) => cls.filter((c, i) => c === "rare" && strat[i] === f).length).every(n => n === 20));

const who = Array.from({ length: 900 }, (_, i) => `p${i % 97}`);
const grouped = assignFolds(900, 5, { groups: i => who[i] });
const foldOf = new Map();
check("a group never lands in two folds",
  who.every((g, i) => (foldOf.has(g) ? foldOf.get(g) === grouped[i] : (foldOf.set(g, grouped[i]), true))));
check("grouped folds still balance their row counts",
  Math.max(...sizes(grouped, 5)) - Math.min(...sizes(grouped, 5)) <= 20);
check("a missing group key is a group of its own, not one shared group",
  new Set(assignFolds(50, 5, { groups: () => null })).size === 5);

/* ── fit on train, apply anywhere ───────────────────────────────────────────── */
const plan = {
  target: "y", task: "classification", dropDuplicates: true,
  numeric: [{ col: "x", impute: "median", flag: true }],
  categorical: [{ col: "c", flag: false }],
  presence: ["p"],
};
const rows = [
  { x: "1", c: "a", p: "",  y: "no" },
  { x: "3", c: "a", p: "v", y: "yes" },
  { x: "",  c: "b", p: "",  y: "no" },
  { x: "5", c: "B", p: "v", y: "yes" },
  { x: "9", c: "a", p: "",  y: "" },          // target missing: never used
  { x: "5", c: "B", p: "v", y: "yes" },        // duplicate of row 3
  { x: "999", c: "zzz", p: "v", y: "no" },     // the held-out row
];
check("rows with no target and duplicate rows are left out",
  usableRows(plan, rows).join() === "0,1,2,3,6");
check("classes are sorted, so their index never depends on row order",
  encodeTarget(plan, rows, [1, 0]).classes.join() === "no,yes"
  && encodeTarget(plan, rows, [1, 0]).y.join() === "1,0");

const train = [0, 1, 2, 3];
const fitted = fitPrep(plan, rows, train);
const same = fitPrep(plan, rows.map((r, i) => (i === 6 ? { ...r, x: "-1e9", c: "a" } : r)), train);
check("nothing is learned from a held-out row: changing it changes no fitted value",
  JSON.stringify(fitted.parts, (k, v) => (v instanceof Map ? [...v] : v))
    === JSON.stringify(same.parts, (k, v) => (v instanceof Map ? [...v] : v)));
const num = fitted.parts.find(p => p.kind === "numeric");
check("the median comes from the training rows (1, 3, 5 → 3), and a missing value takes it",
  num.fill === 3 && transformRows(fitted, rows, [2])[0] === (3 - num.mean) / num.scale);
check("the flag and presence columns mark missing values",
  fitted.width === 1 + 1 + 2 + 1
  && transformRows(fitted, rows, [2]).join() === [(3 - num.mean) / num.scale, 1, 0, 1, 1].join());
check("categories group by the engine's key (\"B\" and \"b\" are one level)",
  fitted.parts.find(p => p.kind === "categorical").levels.join() === "a,b");
check("a level never seen in training is all zeros, not an error",
  transformRows(fitted, rows, [6]).slice(2, 4).join() === "0,0");

const wide = Array.from({ length: 200 }, (_, i) => ({ c: `L${i % 40}`, y: i % 2 ? "a" : "b" }));
const capped = fitPrep({ ...plan, numeric: [], presence: [] }, wide, wide.map((_, i) => i));
check(`more than ${MAX_CATEGORIES} levels keep the top ${MAX_CATEGORIES - 1} and one infrequent bucket`,
  capped.width === MAX_CATEGORIES
  && transformRows(capped, [{ c: "never-seen" }], [0])[MAX_CATEGORIES - 1] === 1);
check("fitPrep can be narrowed to one column",
  fitPrep(plan, rows, train, ["p"]).parts.map(p => p.kind).join() === "missing");

/* ── the plan reads the report's decisions ──────────────────────────────────── */
const n = 400;
const data = Array.from({ length: n }, (_, i) => ({
  id: String(i),
  age: String(20 + (i * 7) % 50),
  income: i % 4 === 0 ? "" : String(1000 + ((i * 37) % 900)),     // 25% missing → flag
  cabin: i % 3 === 0 ? `C${i % 17}` : "",                         // 67% missing → presence
  city: ["north", "south", "east"][i % 3],
  joined: `2020-0${1 + (i % 9)}-1${i % 9}`,
  leak: i % 2 ? "yes" : "no",
  churn: i % 2 ? "yes" : "no",
}));
const report = analyzeDataset(data, Object.keys(data[0]), "churn");
const p = buildPrepPlan(report);
const reasonOf = (col) => p.excluded.find(e => e.col === col)?.reason ?? "";
check("the plan is a classification task with a stratified split", p.usable && p.task === "classification" && p.stratify);
check("an identifier, a date and a leaking column are excluded, each with its reason",
  /identifier/.test(reasonOf("id")) && /date/.test(reasonOf("joined")) && /leakage/.test(reasonOf("leak")));
check("a mostly-empty column is kept only as a presence flag, as the advice says",
  p.presence.includes("cabin") && !p.categorical.some(f => f.col === "cabin"));
check("past 20% missing the value is imputed AND flagged",
  p.numeric.find(f => f.col === "income")?.flag === true && p.numeric.find(f => f.col === "age")?.flag === false);
check("the target is never a feature",
  ![...p.numeric, ...p.categorical].some(f => f.col === "churn") && !p.presence.includes("churn"));

const flat = analyzeDataset(data.map(r => ({ ...r, churn: "yes" })), Object.keys(data[0]), "churn");
check("a constant target gives no plan, and says why",
  buildPrepPlan(flat).usable === false && /never varies/.test(buildPrepPlan(flat).reason));
check("no target gives no plan", buildPrepPlan(analyzeDataset(data, Object.keys(data[0]), null)).usable === false);

/* ── the scikit-learn script ────────────────────────────────────────────────
   These lock its decisions. That it RUNS was verified by executing the generated
   script in Python (scikit-learn 1.7, pandas 2.2) on titanic, penguins, taxis,
   meets and smoking, with and without cleaning rules: every one ran. Fitted on the
   same rows its feature width equals fitPrep's (smoking: 48 both); on its own split
   it can be a column short when a rare level misses the training side (smoking 47),
   which is the point of fitting on train only. */
const script = prepPlanToSklearn(p);
check("the script splits before it fits, and fits on the training rows only",
  script.indexOf("train_test_split(") < script.indexOf("preprocess.fit(X_train)")
  && !/preprocess\.fit\(X\b|fit_transform\(X\)/.test(script));
check("the script stratifies a classification target", /stratify=y/.test(script));
check("every left-out column is named in the script with its reason",
  p.excluded.every(e => script.includes(`#   ${e.col} — ${e.reason}`)));
check("an empty imputation group is still defined, so the script never hits a NameError",
  /^NUMERIC_MOST_FREQUENT = \[\]$/m.test(script) && /^NUMERIC_MEAN = \[/m.test(script));
check("the missing tokens are the engine's own", script.includes('MISSING = ["", "na", "n/a", "nan", "null", "none", "?"]'));
const groupedScript = prepPlanToSklearn({ ...p, groupBy: "city", stratify: false });
check("a grouped plan splits with GroupShuffleSplit on its column, and does not stratify",
  /GroupShuffleSplit\(n_splits=1, test_size=0\.2, random_state=42\)/.test(groupedScript)
  && groupedScript.includes('groups = df.loc[X.index, "city"]') && !/stratify=y/.test(groupedScript));
check("accepted cleaning rules come before anything is split",
  (() => { const s = prepPlanToSklearn(p, [{ column: "city", type: "merge_levels", affixes: [], values: [], merges: [{ from: "East", to: "east" }] }]);
           return s.includes("# merge_levels: city") && s.indexOf("# merge_levels: city") < s.indexOf("train_test_split("); })());

console.log(failed === 0 ? "all prep checks passed" : `${failed} prep check(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
