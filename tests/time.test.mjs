/* Time checks (lib/timeChecks.js) and the date parser they stand on. Every fixture is
   deterministic: a seeded generator, never Math.random. */

import { parseDate, dayFirstFor } from "../src/components/utils/core/detectors/temporal.js";
import { runTimeChecks, DRIFT_RATE } from "../src/lib/timeChecks.js";
import { analyzeDataset } from "../src/components/utils/core/index.js";
import { buildReadiness } from "../src/lib/readiness.js";
import { withDiagnostic } from "../src/lib/prep/diagnostic.js";

let failed = 0;
const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failed++;
};
const iso = (t) => (t === null ? null : new Date(t).toISOString());

/* ── parsing ── */
check("ISO date and datetime, with an offset applied", iso(parseDate("2024-01-15")) === "2024-01-15T00:00:00.000Z"
  && iso(parseDate("2024-01-15T10:30:00+02:00")) === "2024-01-15T08:30:00.000Z");
check("slash dates read by the column's orientation",
  iso(parseDate("03/04/2024")) === "2024-03-04T00:00:00.000Z" && iso(parseDate("03/04/2024", true)) === "2024-04-03T00:00:00.000Z");
check("month names and two-digit years", iso(parseDate("Jan 15, 2024")) === "2024-01-15T00:00:00.000Z"
  && iso(parseDate("15-Jan-85")) === "1985-01-15T00:00:00.000Z" && iso(parseDate("15-Jan-24")) === "2024-01-15T00:00:00.000Z");
check("impossible dates and non-dates are null", parseDate("2024-02-30") === null && parseDate("13/13/2024") === null && parseDate("hello") === null);
check("orientation: a day over 12 settles it; nothing settles it → month-first, flagged",
  dayFirstFor(["25/01/2024", "03/04/2024"]).dayFirst === true && dayFirstFor(["03/04/2024"]).assumed === true);

/* ── a drifting target and a column that starts late ── */
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const day0 = Date.UTC(2020, 0, 1);
const drift = Array.from({ length: 1000 }, (_, i) => ({
  day: new Date(day0 + i * 86400000).toISOString().slice(0, 10),
  x: String((i * 37) % 100),
  promo: i >= 600 ? String(i % 7) : "",
  y: rand() < 0.1 + 0.4 * (i / 1000) ? "1" : "0",
}));
// File order must not matter: shuffle deterministically.
const shuffled = [...drift].sort((a, b) => ((a.x * 7919 + a.day.length) % 13) - ((b.x * 7919 + b.day.length) % 13));
const cols = ["day", "x", "promo", "y"];
const t = runTimeChecks(analyzeDataset(shuffled, cols, "y"), shuffled, Date.UTC(2026, 8, 27));
check("the date column is found and read", t.column === "day" && t.parsed === 1000 && iso(t.from).startsWith("2020-01-01"));
check("five equal periods in date order, not file order",
  t.periods.length === 5 && t.periods.every(p => p.rows === 200) && t.periods[0].to < t.periods[1].from);
check("a rising rate is a drift: beyond chance and by more than 10 points",
  t.target.kind === "rate" && t.target.label === "1" && t.target.drifts && t.target.spread >= DRIFT_RATE && t.target.pValue < 0.001);
check("a column empty in the earliest rows and filled in the latest starts late",
  t.lateColumns.length === 1 && t.lateColumns[0].col === "promo" && t.lateColumns[0].earlyMissingPct === 100);
check("the split cutoff is the 80% point of the period", iso(t.cutoff).startsWith("2022-03-1") && t.recommendTimeSplit);

/* ── a stable target ── */
const stable = drift.map((r, i) => ({ ...r, promo: String(i % 5), y: i % 4 === 0 ? "1" : "0" }));
const s = runTimeChecks(analyzeDataset(stable, cols, "y"), stable, Date.UTC(2026, 8, 27));
check("a steady rate is not a drift, and no time split is demanded", !s.target.drifts && s.lateColumns.length === 0 && !s.recommendTimeSplit);

/* ── a regression target whose mean moves ── */
const reg = drift.map((r, i) => ({ day: r.day, x: r.x, y: String(100 + i * 0.5 + (i % 10)) }));
const g = runTimeChecks(analyzeDataset(reg, ["day", "x", "y"], "y"), reg);
check("a rising mean is a drift for a numeric target", g.target.kind === "mean" && g.target.drifts && g.target.spread >= 0.2);

/* ── dates after today ── */
const future = drift.map((r, i) => (i < 30 ? { ...r, day: "2031-05-01" } : r));
check("dates after the report's own date are counted",
  runTimeChecks(analyzeDataset(future, cols, "y"), future, Date.UTC(2026, 8, 27)).futureRows === 30);

check("no date column, no time checks", runTimeChecks(analyzeDataset(drift.map((r) => ({ x: r.x, promo: r.promo, y: r.y })), ["x", "promo", "y"], "y"), drift) === null);

/* ── what the checklist makes of it ── */
const report = { ...withDiagnostic(analyzeDataset(shuffled, cols, "y"), shuffled), time: t };
const items = buildReadiness(report).items.filter(i => i.tab === "time");
check("the checklist lists the drift and the late column, both pointing at Time",
  items.some(i => /"y" changes over time/.test(i.title)) && items.some(i => /"promo" only exists from part-way/.test(i.title)));
check("the advice covers both readings of a date column",
  items[0].detail.includes("train on rows before") && items[0].detail.includes("derive tenure or age"));

if (failed) { console.error(`${failed} time check(s) failed`); process.exit(1); }
console.log("all time checks passed");
