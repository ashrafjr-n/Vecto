/* Column-dossier eval — runs the REAL /api/ai endpoint over the corpus and scores
   each answer against tools/ai-eval/expectations.mjs.

   It goes through the Worker, not straight to OpenRouter, so what is measured is
   what the app gets: the same prompt, schema, model fallback list and repair
   round. Answers are verified with verifyDossier() before scoring, as on the page.

   Parsing matches Home.jsx and tools/report.mjs (header, skipEmptyLines,
   transformHeader, no dynamicTyping) — a differently parsed file is a different
   dataset. Files over the app's 40MB cap are still evaluated here.

   Quota: one request per file (two if the repair round fires). Answers are cached
   in <out>/<file>.json by a hash of the payload, so a re-run only spends requests
   on files whose payload changed or that failed. A rate-limit response stops the
   run instead of burning the rest of the list.

   Usage:
     npx wrangler dev                               (terminal 1 — reads .dev.vars)
     node --max-old-space-size=8192 tools/ai-eval.mjs [--only=titanic,smoking]
          [--endpoint=http://127.0.0.1:8787/api/ai] [--out=reports/ai-eval]
          [--delay=4000] [--fresh] [--rescore]
     --fresh    ignore cached answers        --rescore  never call; rescore the cache */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import Papa from "papaparse";

import { detectColumnRoles, detectTarget } from "../src/components/utils/core/index.js";
import { transformHeader } from "../src/lib/csvIntake.js";
import { buildDossierPayload, verifyDossier } from "../src/lib/ai/dossier.js";
import { EXPECTATIONS } from "./ai-eval/expectations.mjs";
import { scoreDossier } from "./ai-eval/score.mjs";

const args     = process.argv.slice(2);
const flag     = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const endpoint = flag("endpoint") ?? "http://127.0.0.1:8787/api/ai";
const outDir   = flag("out") ?? "reports/ai-eval";
const delayMs  = Number(flag("delay") ?? 4000);   // free tier: 20 requests/minute
const only     = flag("only")?.split(",");
const fresh    = args.includes("--fresh");
const rescore  = args.includes("--rescore");
const CALL_TIMEOUT_MS = 300_000;   // run 1: events.csv passed 240 s on nemotron-3-ultra

/* The cache key covers the PROMPT as well as the payload. Keyed on the payload
   alone, a prompt change would silently re-score the old prompt's answers. */
const promptHash = createHash("sha256")
  .update(readFileSync("worker/dossierPrompt.js", "utf8"))
  .update(readFileSync("src/lib/ai/dossierSchema.js", "utf8"))
  .digest("hex").slice(0, 8);

const slug = (file) => file.replace(/\.csv$/, "").replace(/[^a-z0-9]+/gi, "_");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(outDir, { recursive: true });
const selected = EXPECTATIONS.filter((e) => !only || only.some((o) => e.file.includes(o)));
const rows = [];
let lastCallAt = 0;

for (const expect of selected) {
  const path = join("forTesting", expect.file);
  const outPath = join(outDir, `${slug(expect.file)}.json`);
  if (!existsSync(path)) {
    console.log(`${expect.file}: MISSING FILE`);
    rows.push({ file: expect.file, error: "file not found" });
    continue;
  }

  const parsed = Papa.parse(readFileSync(path, "utf8"), { header: true, skipEmptyLines: true, transformHeader });
  const data = parsed.data;
  const columns = parsed.meta.fields;
  const roles = detectColumnRoles(data, columns, null);
  const engineTargetGuess = detectTarget(columns, data);

  // An expectation naming a column the file does not have is a bug in the expectation.
  const named = [...(expect.targets ?? []), ...Object.keys(expect.roles ?? {}), ...Object.keys(expect.subtypes ?? {})];
  const unknown = named.filter((c) => !columns.includes(c));
  if (unknown.length) throw new Error(`${expect.file}: expectations name columns not in the file: ${unknown.join(", ")}`);

  const payload = buildDossierPayload(data, columns, roles);
  const payloadJson = JSON.stringify(payload);
  const payloadHash = createHash("sha256").update(payloadJson).update(promptHash).digest("hex").slice(0, 16);

  const cached = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : null;
  const reusable = cached?.payloadHash === payloadHash && cached.response?.result;
  let response;
  let ms = cached?.ms ?? null;
  let source;

  if (reusable && !fresh) {
    response = cached.response;
    source = "cached";
  } else if (rescore) {
    console.log(`${expect.file}: no usable cached answer (--rescore makes no calls)`);
    rows.push({ file: expect.file, error: "not cached" });
    continue;
  } else {
    const wait = lastCallAt + delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
    const t0 = Date.now();
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: "dossier", payload }),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
      response = { status: res.status, ...(await res.json().catch(() => ({ error: "non_json_response" }))) };
    } catch (err) {
      response = { status: 0, error: "request_failed", message: err.message };
    }
    ms = Date.now() - t0;
    source = "live";
  }

  const verified = response.result ? verifyDossier(response.result, { data, columns, roles }) : null;
  const error = response.result ? verified.error ?? null : `${response.error}${response.message ? `: ${response.message}` : ""}`;
  const score = verified && !verified.error ? scoreDossier(expect, verified, engineTargetGuess) : null;

  writeFileSync(outPath, JSON.stringify({
    file: expect.file, rows: data.length, columns: columns.length, engineTargetGuess,
    model: response.model ?? null, ms, payloadChars: payloadJson.length, payloadHash, promptHash,
    error, score, verified, response,
  }, null, 2));

  const row = { file: expect.file, source, model: response.model ?? null, ms, columns: columns.length, error, score, engineTargetGuess };
  rows.push(row);
  console.log(error
    ? `${expect.file}: ERROR (${source}) — ${error}`
    : `${expect.file}: ${score.passed}/${score.total} (${source}, ${response.model}, ${(ms / 1000).toFixed(1)}s)`
      + ` · top target ${score.checks.find((c) => c.kind === "target@1")?.got ?? "n/a"}`
      + ` · withheld ${score.hygiene.withheld} · undescribed ${score.hygiene.undescribed}`);

  if (response.error === "rate_limited") {
    console.log("\nRate-limited — stopping so the remaining files keep their quota. Re-run later; finished files stay cached.");
    break;
  }
}

writeFileSync(join(outDir, "summary.md"), summarize(rows));
console.log(`\n→ ${join(outDir, "summary.md")}`);

function summarize(results) {
  const ok = results.filter((r) => r.score);
  const all = ok.flatMap((r) => r.score.checks);
  const pct = (list) => (list.length ? `${Math.round((100 * list.filter((c) => c.ok).length) / list.length)}% (${list.filter((c) => c.ok).length}/${list.length})` : "n/a");
  const kind = (k) => all.filter((c) => c.kind === k);
  const withTarget = ok.filter((r) => r.score.engineTargetOk !== null);
  const models = [...new Set(ok.map((r) => r.model))];

  const lines = [
    `# Column dossier eval — ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
    "",
    `Endpoint \`${endpoint}\` · prompt \`${promptHash}\` · ${ok.length}/${results.length} files answered · models: ${models.join(", ") || "none"}`,
    "",
    "| Measure | Score |",
    "| --- | --- |",
    `| All checks | ${pct(all)} |`,
    `| Target, top pick (AI) | ${pct(kind("target@1"))} |`,
    `| Target, top pick (engine's detectTarget) | ${withTarget.length ? `${Math.round((100 * withTarget.filter((r) => r.score.engineTargetOk).length) / withTarget.length)}% (${withTarget.filter((r) => r.score.engineTargetOk).length}/${withTarget.length})` : "n/a"} |`,
    `| Target, any of top 3 (AI) | ${pct(kind("target@3"))} |`,
    `| Roles | ${pct(kind("role"))} |`,
    `| Subtypes | ${pct(kind("subtype"))} |`,
    "",
    "| File | Model | Time | Score | AI top target | Engine target | Withheld | Undescribed | Contradicted roles |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...results.map((r) => r.score
      ? `| ${r.file} | ${r.model} | ${(r.ms / 1000).toFixed(1)}s | ${r.score.passed}/${r.score.total} | ${r.score.checks.find((c) => c.kind === "target@1")?.got ?? "—"} | ${r.engineTargetGuess} | ${r.score.hygiene.withheld} | ${r.score.hygiene.undescribed} | ${r.score.hygiene.contradictedRoles} |`
      : `| ${r.file} | — | — | ERROR | ${r.error} | | | | |`),
    "",
    "## Failed checks",
    "",
    ...ok.flatMap((r) => r.score.checks.filter((c) => !c.ok)
      .map((c) => `- **${r.file}** ${c.kind} \`${c.name}\`: got \`${JSON.stringify(c.got)}\`, want one of \`${c.want.join(" | ")}\``)),
    "",
  ];
  return lines.join("\n");
}
