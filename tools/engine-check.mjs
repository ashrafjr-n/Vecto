/* Engine check — the deterministic half of a test set, 0 requests (vecto-plan item 40).

   For each ENGINE_EXPECTATIONS entry in tools/ai-eval/<set>-expectations.mjs, runs what the
   app's worker runs (analyzeWithDiagnostic) plus the preparation plan, and checks:
     crash    the analysis and the diagnostic both finish without a throw
     silent   every non-target column is scored against the target OR named in
              relationships.unscoredColumns — nothing leaves the scan without a trace
     signal   the diagnostic's "any signal" verdict matches the documentation (null: reported only)

   Parsing and decoding match Home.jsx (decodeCsv), like tools/report.mjs.
   Writes reports/engine-check-<set>/summary.md.

   Usage: node --max-old-space-size=8192 tools/engine-check.mjs --set=final */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import Papa from "papaparse";

import { transformHeader, decodeCsv } from "../src/lib/csvIntake.js";
import { analyzeWithDiagnostic } from "../src/lib/prep/diagnostic.js";
import { buildPrepPlan } from "../src/lib/prep/plan.js";

const set = process.argv.find((a) => a.startsWith("--set="))?.slice(6);
if (!set) throw new Error("usage: node tools/engine-check.mjs --set=<name>");
const { ENGINE_EXPECTATIONS } = await import(`./ai-eval/${set}-expectations.mjs`);
const outDir = `reports/engine-check-${set}`;
mkdirSync(outDir, { recursive: true });

const fmt = (x) => (typeof x === "number" ? x.toFixed(3) : String(x));
const rows = [];

for (const e of ENGINE_EXPECTATIONS) {
  const parsed = Papa.parse(decodeCsv(readFileSync(join("forTesting", e.file))).text, { header: true, skipEmptyLines: true, transformHeader });
  const columns = parsed.meta.fields;
  const checks = [];
  let result = null;

  const t0 = performance.now();
  try {
    result = analyzeWithDiagnostic(parsed.data, columns, e.target);
  } catch (err) {
    checks.push({ kind: "crash", ok: false, note: err?.message ?? String(err) });
  }
  const ms = Math.round(performance.now() - t0);

  if (result) {
    checks.push({ kind: "crash", ok: true });
    const rel = result.relationships;
    const accounted = new Set([e.target, ...Object.keys(rel.targetCorrelations ?? {}), ...(rel.unscoredColumns ?? []).map((u) => u.col)]);
    const silent = columns.filter((c) => !accounted.has(c));
    checks.push({ kind: "silent", ok: silent.length === 0, note: silent.length ? `unaccounted: ${silent.join(", ")}` : `${columns.length - 1} columns accounted` });

    const d = result.diagnostic;
    const got = d.status === "ok" ? d.signal : `unavailable (${d.reason})`;
    if (e.signal !== null) checks.push({ kind: "signal", ok: got === e.signal, note: `got ${got}, want ${e.signal}` });
  }

  const d = result?.diagnostic;
  const plan = result ? buildPrepPlan(result) : null;
  rows.push({
    file: e.file, ms, checks,
    health: result?.healthScore?.score ?? null,
    suspects: result?.relationships?.leakageSuspects?.map((s) => s.col ?? s.feature).join(", ") || "—",
    diag: d?.status === "ok"
      ? `${d.metric} ${fmt(d.model.mean)} vs ${fmt(d.baseline.mean)} · t ${fmt(d.t)} · ${d.unstable ? `R² UNSTABLE (worst fold baseline ${fmt(d.worstBaseline)})` : `signal ${d.signal}`}${d.nearPerfect ? " · NEAR-PERFECT" : ""}${d.suspicious.length ? ` · too good: ${d.suspicious.join(", ")}` : ""} · split ${d.split}`
      : d ? `unavailable: ${d.reason}` : "—",
    plan: plan?.usable ? `${plan.numeric.length} numeric, ${plan.categorical.length} categorical, ${plan.presence.length} presence, ${plan.excluded.length} excluded${plan.groupBy ? `, grouped by ${plan.groupBy}` : ""}` : plan ? `not usable: ${plan.reason}` : "—",
  });
  const r = rows.at(-1);
  console.log(`${e.file}: ${checks.filter((c) => c.ok).length}/${checks.length} (${(ms / 1000).toFixed(1)}s) · ${r.diag}`);
}

const all = rows.flatMap((r) => r.checks);
writeFileSync(join(outDir, "summary.md"), [
  `# Engine check — ${set} — ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
  "",
  `All checks: ${all.filter((c) => c.ok).length}/${all.length}`,
  "",
  "| File | Time | Checks | Health | Engine leak flags | Diagnostic | Preparation plan |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  ...rows.map((r) => `| ${r.file} | ${(r.ms / 1000).toFixed(1)}s | ${r.checks.filter((c) => c.ok).length}/${r.checks.length} | ${r.health ?? "—"} | ${r.suspects} | ${r.diag} | ${r.plan} |`),
  "",
  "## Failed checks",
  "",
  ...rows.flatMap((r) => r.checks.filter((c) => !c.ok).map((c) => `- **${r.file}** ${c.kind}: ${c.note}`)),
  "",
].join("\n"));
console.log(`\n→ ${join(outDir, "summary.md")}`);
