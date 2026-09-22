/* AI eval — runs a REAL /api/ai task over the corpus and scores each answer
   against known answers written before the first run.

     --task=review   (default) B+D merged — what each column is, target suggestions and
                     cleaning rules in one request. Scored on BOTH expectation files
                     (tools/ai-eval/expectations.mjs, cleaning-expectations.mjs),
                     reported apart as "B checks" and "D checks".
     --task=leakage  phase C, tools/ai-eval/leakage-expectations.mjs

   It goes through the Worker, not straight to OpenRouter, so what is measured is
   what the app gets: the same prompt, schema, model fallback list and repair
   round. Every answer is verified exactly as the page verifies it before scoring.

   Parsing matches Home.jsx and tools/report.mjs (header, skipEmptyLines,
   transformHeader, no dynamicTyping) — a differently parsed file is a different
   dataset. Files over the app's 40MB cap are still evaluated here.

   Quota: one request per file (a review on a wide file takes one per 25 columns;
   the repair round can add one). Answers are cached in <out>/<file>.json, keyed
   on the payload AND the task's prompt file, so a re-run only spends requests on
   what changed or failed. A rate-limit response stops the run.

   Usage:
     npx wrangler dev                               (terminal 1 — reads .dev.vars)
     node --max-old-space-size=8192 tools/ai-eval.mjs [--task=leakage] [--only=titanic,smoking]
          [--endpoint=http://127.0.0.1:8787/api/ai] [--out=reports/ai-eval]
          [--delay=4000] [--fresh] [--rescore] [--set=validation]
     --fresh    ignore cached answers        --rescore  never call; rescore the cache
     --set=X    score tools/ai-eval/X-expectations.mjs instead of the tuning corpus, into
                <out>-X (vecto-plan item 19: validation and test sets, never tuned on) */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import Papa from "papaparse";

import { analyzeDataset, detectColumnRoles, detectTarget } from "../src/components/utils/core/index.js";
import { transformHeader } from "../src/lib/csvIntake.js";
import { askDossier } from "../src/lib/ai/askDossier.js";
import { buildLeakagePayload, verifyLeakage } from "../src/lib/ai/leakage.js";
import { findCleaningCandidates } from "../src/lib/ai/cleaning.js";
import { buildReviewPayload, verifyReview } from "../src/lib/ai/review.js";
import { EXPECTATIONS } from "./ai-eval/expectations.mjs";
import { LEAKAGE_EXPECTATIONS } from "./ai-eval/leakage-expectations.mjs";
import { CLEANING_EXPECTATIONS } from "./ai-eval/cleaning-expectations.mjs";
import { scoreDossier, scoreLeakage, scoreCleaning } from "./ai-eval/score.mjs";

const args     = process.argv.slice(2);
const flag     = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const taskName = flag("task") ?? "review";
const endpoint = flag("endpoint") ?? "http://127.0.0.1:8787/api/ai";
const delayMs  = Number(flag("delay") ?? 4000);   // free tier: 20 requests/minute
const only     = flag("only")?.split(",");
const fresh    = args.includes("--fresh");
const rescore  = args.includes("--rescore");
const set      = flag("set");
const { EXPECTATIONS: REVIEW_SET, LEAKAGE_EXPECTATIONS: LEAKAGE_SET, CLEANING_EXPECTATIONS: CLEANING_SET } = set
  ? await import(`./ai-eval/${set}-expectations.mjs`)
  : { EXPECTATIONS, LEAKAGE_EXPECTATIONS, CLEANING_EXPECTATIONS };
const CALL_TIMEOUT_MS = 300_000;   // run 1: events.csv passed 240 s on nemotron-3-ultra

const pctOf = (list) => (list.length ? `${Math.round((100 * list.filter((c) => c.ok).length) / list.length)}% (${list.filter((c) => c.ok).length}/${list.length})` : "n/a");

const cleaningFor = (e) => CLEANING_SET.find((c) => c.file === e.file);

/* One entry per task: which answers it is scored against, which files key its cache,
   how a file becomes a payload, and how the answer is asked for, verified and scored. */
const TASK_DEFS = {
  leakage: {
    title: "Leakage review",
    outDir: "reports/ai-eval-leakage",
    expectations: LEAKAGE_SET,
    promptFiles: ["worker/leakagePrompt.js", "src/lib/ai/leakageSchema.js"],
    named: (e) => [e.target, ...Object.keys(e.leaks ?? {}), ...(e.clean ?? [])],
    /* Reviewed WITHOUT a dossier: the harder case, and it keeps this score
       independent of phase B's answers. The page adds meanings when the user has
       asked for a dossier. */
    prepare: (e, data, columns) => {
      const result = analyzeDataset(data, columns, e.target);
      return { result, payload: buildLeakagePayload(result, null) };
    },
    ask: (ctx, send) => send("leakage", ctx.payload),
    verify: (answer, ctx, data) => verifyLeakage(answer, { data, result: ctx.result }),
    score: (e, verified) => scoreLeakage(e, verified),
    record: () => ({}),
    line: (s) => `findings ${s.hygiene.findings} · ${Object.entries(s.hygiene.verdicts).map(([k, v]) => `${k} ${v}`).join(", ") || "no verdicts"} · withheld ${s.hygiene.withheld}`,
    measures: (all) => [
      ["Known leaks raised", pctOf(all.filter((c) => c.kind === "leak"))],
      ["Legitimate predictors left alone", pctOf(all.filter((c) => c.kind === "clean"))],
      ["Split strategy", pctOf(all.filter((c) => c.kind === "split"))],
    ],
    columns: ["Findings", "Verdicts", "Withheld", "Engine-only flags"],
    cells: (r) => [r.score.hygiene.findings, Object.entries(r.score.hygiene.verdicts).map(([k, v]) => `${k} ${v}`).join(", ") || "—", r.score.hygiene.withheld, r.score.hygiene.engineOnly],
  },

  review: {
    title: "Column review (B+D)",
    outDir: "reports/ai-eval-review",
    expectations: REVIEW_SET,
    promptFiles: ["worker/reviewPrompt.js", "src/lib/ai/reviewSchema.js", "src/lib/ai/dossierSchema.js", "src/lib/ai/cleaningSchema.js"],
    named: (e) => {
      const d = cleaningFor(e);
      return [
        ...(e.targets ?? []), ...Object.keys(e.roles ?? {}), ...Object.keys(e.subtypes ?? {}),
        ...Object.keys(e.sensitive ?? {}),
        ...(d ? [...(d.rules ?? []).map((r) => r.column), ...Object.keys(d.forbidden ?? {})] : []),
      ];
    },
    prepare: (e, data, columns) => {
      const roles = detectColumnRoles(data, columns, null);
      const candidates = findCleaningCandidates(data, columns, roles);
      return { roles, candidates, engineTargetGuess: detectTarget(columns, data), payload: buildReviewPayload(data, columns, roles, candidates) };
    },
    ask: (ctx, send) => askDossier(ctx.payload, (part) => send("review", part)),
    verify: (answer, ctx, data, columns) => verifyReview(answer, { data, columns, roles: ctx.roles, candidates: ctx.candidates }),
    score: (e, verified, ctx) => {
      const b = scoreDossier(e, verified.dossier, ctx.engineTargetGuess);
      const d = cleaningFor(e) ? scoreCleaning(cleaningFor(e), verified.cleaning) : null;
      const checks = [...b.checks, ...(d?.checks ?? [])];
      return { ...b, passed: checks.filter((c) => c.ok).length, total: checks.length, checks, hygiene: { ...b.hygiene, ...(d?.hygiene ?? { rules: verified.cleaning.rules.length }) } };
    },
    record: (ctx) => ({ engineTargetGuess: ctx.engineTargetGuess, candidateColumns: ctx.candidates.map((c) => c.name) }),
    line: (s) => `top target ${s.checks.find((c) => c.kind === "target@1")?.got ?? "n/a"} · withheld ${s.hygiene.withheld} · undescribed ${s.hygiene.undescribed} · rules ${s.hygiene.rules}`,
    measures: (all, ok) => {
      const isB = (c) => ["target@1", "target@3", "role", "subtype"].includes(c.kind);
      /* `sensitive` (item 29) belongs to neither half. It arrived in the same answer as
         B and D, but it is not a column profile and not a cleaning rule, and counting it
         under D made the cleaning line read 100% → 94% on a run where every cleaning
         check still passed. It has its own two lines below. */
      const isD = (c) => !isB(c) && c.kind !== "sensitive";
      const withTarget = ok.filter((r) => r.score.engineTargetOk !== null);
      const engineRight = withTarget.filter((r) => r.score.engineTargetOk).length;
      return [
        ["B checks (day 1: 99%, 188/189)", pctOf(all.filter(isB))],
        ["D checks (day 1: 100%, 19/19)", pctOf(all.filter(isD))],
        ["Target, top pick (AI)", pctOf(all.filter((c) => c.kind === "target@1"))],
        ["Target, top pick (engine's detectTarget)", withTarget.length ? `${Math.round((100 * engineRight) / withTarget.length)}% (${engineRight}/${withTarget.length})` : "n/a"],
        ["Target, any of top 3 (AI)", pctOf(all.filter((c) => c.kind === "target@3"))],
        ["Roles", pctOf(all.filter((c) => c.kind === "role"))],
        ["Subtypes", pctOf(all.filter((c) => c.kind === "subtype"))],
        /* Split, because the two halves fail for opposite reasons: missing a real
           sensitive attribute is under-reading, and labelling a penguin's sex is
           reading the column NAME. One percentage would hide both. */
        ["Sensitive, attribute named", pctOf(all.filter((c) => c.kind === "sensitive" && !c.want.includes(null)))],
        ["Sensitive, correctly left null", pctOf(all.filter((c) => c.kind === "sensitive" && c.want.includes(null)))],
        ["Expected rules proposed", pctOf(all.filter((c) => c.kind === "rule"))],
        ["Factors and bounds right", pctOf(all.filter((c) => c.kind === "factor"))],
        ["Wrong rules declined", pctOf(all.filter((c) => c.kind === "declined" || c.kind === "quiet"))],
      ];
    },
    columns: ["AI top target", "Engine target", "Withheld", "Undescribed", "Contradicted roles", "Candidate columns", "Rules"],
    cells: (r) => [
      r.score.checks.find((c) => c.kind === "target@1")?.got ?? "—", r.record.engineTargetGuess,
      r.score.hygiene.withheld, r.score.hygiene.undescribed, r.score.hygiene.contradictedRoles,
      r.record.candidateColumns?.join(", ") || "—", r.score.hygiene.rules,
    ],
  },
};

const def = TASK_DEFS[taskName];
if (!def) throw new Error(`unknown --task=${taskName} (use ${Object.keys(TASK_DEFS).join(" or ")})`);
const outDir = flag("out") ?? (set ? `${def.outDir}-${set}` : def.outDir);

/* The cache key covers the PROMPT as well as the payload. Keyed on the payload
   alone, a prompt change would silently re-score the old prompt's answers. */
const promptHash = def.promptFiles
  .reduce((h, f) => h.update(readFileSync(f, "utf8")), createHash("sha256"))
  .digest("hex").slice(0, 8);

const slug = (file) => file.replace(/\.csv$/, "").replace(/[^a-z0-9]+/gi, "_");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lastCallAt = 0;
/* Worker calls that needed its provider retry (item 43), counted per file — a wide file is
   several calls, so the count lives here rather than on the merged answer. */
let retries = 0;
async function send(task, payload) {
  const wait = lastCallAt + delayMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task, payload }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    const body = await res.json().catch(() => ({ error: "non_json_response" }));
    if (body.retried) retries += 1;
    return body.result ? { result: body.result, model: body.model } : { error: body.error, message: body.message, status: res.status };
  } catch (err) {
    return { error: "request_failed", message: err.message, status: 0 };
  }
}

mkdirSync(outDir, { recursive: true });
const selected = def.expectations.filter((e) => !only || only.some((o) => e.file.includes(o)));
const rows = [];

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

  // An expectation naming a column the file does not have is a bug in the expectation.
  const unknown = def.named(expect).filter((c) => !columns.includes(c));
  if (unknown.length) throw new Error(`${expect.file}: expectations name columns not in the file: ${unknown.join(", ")}`);

  const ctx = def.prepare(expect, data, columns);
  /* A task can decline to ask (the cleaning scan found nothing). That is the right
     answer for a clean file, so it is scored — against an empty proposal — not dropped. */
  if (ctx.skip) {
    const score = def.score(expect, { rules: [], findings: [], withheld: [], engineOnly: [] }, ctx);
    rows.push({ file: expect.file, source: "skipped", model: null, ms: 0, error: null, score, record: def.record(ctx) });
    console.log(`${expect.file}: ${score.passed}/${score.total} (skipped: ${ctx.skip})`);
    continue;
  }
  const payloadJson = JSON.stringify(ctx.payload);
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
    const t0 = Date.now();
    retries = 0;
    const reply = await def.ask(ctx, send);
    response = reply.error
      ? { error: reply.error, message: reply.message ?? null, status: reply.status }
      : { result: reply.result, model: reply.model, parts: reply.parts };
    ms = Date.now() - t0;
    source = "live";
  }

  const verified = response.result ? def.verify(response.result, ctx, data, columns) : null;
  const error = response.result ? verified.error ?? null : `${response.error}${response.message ? `: ${response.message}` : ""}`;
  const score = verified && !verified.error ? def.score(expect, verified, ctx) : null;
  const record = def.record(ctx);

  writeFileSync(outPath, JSON.stringify({
    file: expect.file, task: taskName, rows: data.length, columns: columns.length, ...record,
    model: response.model ?? null, ms, retries: source === "live" ? retries : cached?.retries ?? 0,
    payloadChars: payloadJson.length, payloadHash, promptHash,
    error, score, verified, response,
  }, null, 2));

  // A cached answer keeps the count it was recorded with.
  const fileRetries = source === "live" ? retries : cached?.retries ?? 0;
  rows.push({ file: expect.file, source, model: response.model ?? null, ms, error, score, record, retries: fileRetries });
  console.log(error
    ? `${expect.file}: ERROR (${source}) — ${error}`
    : `${expect.file}: ${score.passed}/${score.total} (${source}, ${response.model}, ${(ms / 1000).toFixed(1)}s) · ${def.line(score)}`);

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
  const models = [...new Set(ok.map((r) => r.model))];
  const blank = def.columns.map(() => "").join(" | ");

  return [
    `# ${def.title} eval — ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
    "",
    `Endpoint \`${endpoint}\` · prompt \`${promptHash}\` · ${ok.length}/${results.length} files answered · models: ${models.join(", ") || "none"}`,
    "",
    /* Item 43: the overload retry is proven or disproven by real traffic, never by probes. */
    `Provider retries (an error inside a 200, retried once): ${results.filter((r) => r.retries).length} file(s) — ${results.filter((r) => r.retries && r.score).length} answered after it, ${results.filter((r) => r.retries && !r.score).length} still failed`,
    "",
    "| Measure | Score |",
    "| --- | --- |",
    `| All checks | ${pctOf(all)} |`,
    ...def.measures(all, ok).map(([name, value]) => `| ${name} | ${value} |`),
    "",
    `| File | Model | Time | Score | ${def.columns.join(" | ")} |`,
    `| --- | --- | --- | --- | ${def.columns.map(() => "---").join(" | ")} |`,
    ...results.map((r) => (r.score
      ? `| ${r.file} | ${r.model ?? r.source} | ${(r.ms / 1000).toFixed(1)}s | ${r.score.passed}/${r.score.total} | ${def.cells(r).join(" | ")} |`
      : `| ${r.file} | — | — | ERROR: ${r.error} | ${blank} |`)),
    "",
    "## Failed checks",
    "",
    ...ok.flatMap((r) => r.score.checks.filter((c) => !c.ok)
      .map((c) => `- **${r.file}** ${c.kind} \`${c.name}\`: got \`${JSON.stringify(c.got)}\`, want one of \`${c.want.join(" | ")}\``)),
    /* Not failures and not passes: claims about columns no expectation names. They score
       nothing either way, so they are only visible if they are printed. */
    ...(ok.some((r) => r.score.unchecked?.length)
      ? ["", "## Findings on unlabelled columns — read by hand, do not add expectations to fit them", "",
        ...ok.flatMap((r) => (r.score.unchecked ?? [])
          .map((u) => `- **${r.file}** \`${u.column}\` raised as ${u.category} (verdict: ${u.verdict})`))]
      : []),
    "",
  ].join("\n");
}
