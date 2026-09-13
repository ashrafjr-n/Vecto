/* ai-leakage.test.mjs — plain Node, no framework.

   Phase C's pure halves: what the leakage review SENDS (no values) and how each
   claim is turned into a measurement before it is shown. No network. */

import { analyzeDataset } from "../src/components/utils/core/index.js";
import { buildLeakagePayload, verifyLeakage, evaluateFormula, measureGroupLeak } from "../src/lib/ai/leakage.js";
import { ROLE } from "../src/components/utils/core/roles.constants.js";

let failures = 0;
function check(name, ok) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}

/* A taxi-like file with a regression target `fare`: `total` is fare + tip + tolls
   on every row, `driver` repeats and is tied to the fare level, `rating` is noise,
   and `marker` carries a sentinel that must never appear in the payload. */
const ROWS = Array.from({ length: 400 }, (_, i) => {
  const driver = `d${i % 40}`;
  const fare = 5 + (i % 40) + ((i * 7) % 5) * 0.25;
  const tip = Math.round(fare * 0.15 * 100) / 100;
  const tolls = i % 9 === 0 ? 5.76 : 0;
  return {
    trip_id: String(i + 1),
    pickup: `2019-03-${String((i % 28) + 1).padStart(2, "0")} 10:00:00`,
    driver,
    distance: String((fare / 2.5).toFixed(2)),
    fare: fare.toFixed(2),
    tip: tip.toFixed(2),
    tolls: tolls.toFixed(2),
    total: (fare + tip + tolls).toFixed(2),
    rating: String((i * 13) % 5 + 1),
    marker: "SECRET_VALUE_" + i,
  };
});
const COLUMNS = Object.keys(ROWS[0]);
const result = analyzeDataset(ROWS, COLUMNS, "fare");

console.log("PAYLOAD — no values leave the browser\n");

const dossier = { rowGrain: "one taxi trip", columns: [{ name: "total", meaning: "amount charged", subtype: "measurement", unit: "USD" }] };
const payload = buildLeakagePayload(result, dossier);
const payloadText = JSON.stringify(payload);
check("no cell values are sent", !payloadText.includes("SECRET_VALUE") && !payloadText.includes("2019-03") && !payloadText.includes("d17"));
check("the target is described separately and not repeated in columns",
  payload.target.name === "fare" && !payload.columns.some((c) => c.name === "fare"));
check("the engine's measured association travels with each feature",
  payload.columns.find((c) => c.name === "total").association?.metric === "pearson");
check("dossier meaning and row grain are included when the user asked for one",
  payload.rowGrain === "one taxi trip" && payload.columns.find((c) => c.name === "total").meaning === "amount charged");
check("without a dossier there is no meaning key at all",
  !JSON.stringify(buildLeakagePayload(result, null)).includes('"meaning"'));

console.log("\nMEASUREMENTS\n");

check("a true formula holds on every row", evaluateFormula(ROWS, { result: "total", op: "sum", terms: ["fare", "tip", "tolls"] }).matchShare === 1);
check("a false formula does not", evaluateFormula(ROWS, { result: "total", op: "sum", terms: ["fare", "tip"] }).matchShare < 0.95);
check("a ratio divides", evaluateFormula([{ a: "10", b: "4", c: "2.5" }], { result: "c", op: "ratio", terms: ["a", "b"] }).matchShare === 1);
check("rows with a non-numeric term are skipped, not counted",
  evaluateFormula([{ a: "x", b: "1", c: "1" }, { a: "1", b: "1", c: "2" }], { result: "c", op: "sum", terms: ["a", "b"] }).n === 1);

const g = measureGroupLeak(ROWS, "driver", "fare", ROLE.NUMERIC);
check("a repeated entity key is measured: groups, shared rows, rank η", g.groups === 40 && g.repeatedRowShare === 1 && g.eta > 0.9);
const classRows = ROWS.map((r, i) => ({ ...r, label: i % 40 < 20 ? "high" : "low" }));
const gc = measureGroupLeak(classRows, "driver", "label", ROLE.BINARY);
check("for a class target, purity is reported beside the baseline", gc.purity === 1 && gc.baseline === 0.5);
check("a unique column has no repeated rows", measureGroupLeak(ROWS, "trip_id", "fare", ROLE.NUMERIC).repeatedRowShare === 0);

/* The taxis shape: total carries a surcharge from a small fixed set. */
const surcharged = ROWS.map((r, i) => ({ ...r, total: (+r.fare + +r.tip + +r.tolls + [3.3, 3.8, 0.8][i % 3]).toFixed(2) }));
const fixed = evaluateFormula(surcharged, { result: "total", op: "sum", terms: ["fare", "tip", "tolls"] });
check("a formula off by a few fixed amounts is recognised as such",
  fixed.matchShare === 0 && fixed.fixedOffsetShare === 1 && fixed.fixedOffsets.length === 3);
const scattered = evaluateFormula(ROWS, { result: "total", op: "sum", terms: ["fare", "rating"] });
check("a wrong formula scatters its differences", scattered.fixedOffsetShare < 0.9);
const surchargedResult = analyzeDataset(surcharged, COLUMNS, "fare");
const fv = verifyLeakage({ findings: [{ column: "total", category: "derived_from_target", reason: "", formula: { result: "total", op: "sum", terms: ["fare", "tip", "tolls"] } }], split: null },
  { data: surcharged, result: surchargedResult }).findings[0];
check("that verdict is partial and names the amounts", fv.verdict === "partial" && /\+3\.3 on 33\.\d%/.test(fv.verdictText));

console.log("\nVERIFY\n");

const answer = {
  findings: [
    { column: "total", category: "derived_from_target", reason: "a total includes the fare", formula: { result: "total", op: "sum", terms: ["fare", "tip", "tolls"] } },
    { column: "tip", category: "derived_from_target", reason: "tip is a share of fare", formula: { result: "tip", op: "product", terms: ["fare", "rating"] } },
    { column: "distance", category: "derived_from_target", reason: "bad formula", formula: { result: "distance", op: "sum", terms: ["pickup"] } },
    { column: "driver", category: "group_leak", reason: "same driver on both sides", formula: null },
    { column: "trip_id", category: "group_leak", reason: "ids", formula: null },
    { column: "rating", category: "restates_label", reason: "claims rating is the fare", formula: null },
    { column: "tolls", category: "recorded_after_outcome", reason: "tolls known at drop-off", formula: null },
    { column: "ghost", category: "restates_label", reason: "x", formula: null },
    { column: "fare", category: "restates_label", reason: "x", formula: null },
    { column: "tip", category: "banana", reason: "x", formula: null },
    { column: "total", category: "derived_from_target", reason: "duplicate", formula: null },
  ],
  split: { strategy: "grouped", column: "driver", reason: "drivers repeat" },
};
const v = verifyLeakage(answer, { data: ROWS, result });
const byCol = (col, cat) => v.findings.find((f) => f.column === col && f.category === cat);

check("a malformed answer is an error, not a crash", !!verifyLeakage({}, { data: ROWS, result }).error);
check("a formula that holds is confirmed with the rows it was checked on",
  byCol("total", "derived_from_target").verdict === "confirmed" && /100% of 400 rows/.test(byCol("total", "derived_from_target").verdictText));
check("a formula that fails on the data is contradicted", byCol("tip", "derived_from_target").verdict === "contradicted");
check("a formula over a non-numeric or unrelated column is withheld, the claim stays unchecked",
  byCol("distance", "derived_from_target").verdict === "unchecked" && v.withheld.some((w) => w.column === "distance" && /formula withheld/.test(w.reason)));
check("a real entity key is a confirmed group leak", byCol("driver", "group_leak").verdict === "confirmed");
check("a unique id claimed as a group leak is contradicted", byCol("trip_id", "group_leak").verdict === "contradicted");
check("restates_label on a weak association is contradicted by the engine's measurement", byCol("rating", "restates_label").verdict === "contradicted");
check("recorded_after_outcome is a question, never a finding", byCol("tolls", "recorded_after_outcome").verdict === "question");
check("unknown columns, the target itself and bad categories are withheld",
  ["ghost", "fare", "tip"].every((c) => v.withheld.some((w) => w.column === c)) && !byCol("tip", "banana"));
check("a duplicate column+category keeps the first", v.findings.filter((f) => f.column === "total").length === 1);
check("a grouped split is measured", v.split.strategy === "grouped" && /100% of rows share/.test(v.split.note));
check("a time-ordered split on a non-date column is noted",
  /not read as a date/.test(verifyLeakage({ findings: [], split: { strategy: "time_ordered", column: "rating", reason: "" } }, { data: ROWS, result }).split.note));
const silent = verifyLeakage({ findings: [], split: null }, { data: ROWS, result });
check("the engine flags total (r ≈ 1) — the fixture really exercises engineOnly",
  result.relationships.leakageSuspects.some((l) => l.col === "total"));
check("an engine leakage flag the model did not mention is listed; a mentioned one is not",
  silent.engineOnly.some((e) => e.column === "total") && !v.engineOnly.some((e) => e.column === "total"));

console.log(failures ? `\n${failures} failure(s)` : "\nall ai-leakage checks passed");
process.exit(failures ? 1 : 0);
