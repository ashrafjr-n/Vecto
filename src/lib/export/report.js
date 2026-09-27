/* Exporting a finished report — so it can be kept, attached to a ticket or sent to a
   mentor, instead of living only in one browser tab.

   One content model (reportModel), three renderings (Markdown, a self-contained HTML
   page, JSON), plus a data dictionary as CSV. Pure: every figure is read from the
   report, nothing is recomputed except the dictionary's per-column counts.

   What an export does NOT carry: the rows. The report's 10-row preview is left out of
   every format, and the few example values the dictionary lists are masked for
   personal data — an export is made to be shared. */

import { buildReadiness } from "../readiness.js";
import { buildPrepPlan } from "../prep/plan.js";
import { isMissing, normalizeValue } from "../../components/utils/core/helpers.js";
import { maskPersonalData } from "../../components/utils/core/detectors/personal.js";

export const EXPORT_VERSION = 1;
const SITE = "https://vecto.aannaelj.workers.dev";

const METRIC = { pearson: "r", cramers_v: "Cramér's V", eta: "η (rank)", presence: "V of presence" };
const VERDICT = { blocked: "Not ready to train", fix: "Ready after fixes", ready: "Ready to train", no_target: "No target chosen" };
const LEVEL = { blocker: "Blocker", fix: "Fix before training", note: "Worth knowing" };
const num = (x, d = 3) => (Number.isFinite(x) ? String(Number(x.toFixed(d))) : "—");
const pct = (n, d) => (d > 0 ? `${Number(((n / d) * 100).toFixed(1))}%` : "—");

/* ── the content model ──────────────────────────────────────────────────────
   → { title, subtitle, facts: [[label, value]], sections: [{ heading, blocks }] }
   A block is { p } | { list: [{ strong?, text }] } | { table: { head, rows } }. */
export function reportModel(result, { fileName = null, generatedAt = new Date() } = {}) {
  const { meta, quality, healthScore, relationships, recommendations, diagnostic } = result;
  const readiness = buildReadiness(result);
  const sections = [];

  sections.push({
    heading: `Ready to train? — ${VERDICT[readiness.verdict]}`,
    blocks: readiness.items.length
      ? [{ list: readiness.items.map((i) => ({ strong: `${LEVEL[i.level]}: ${i.title}.`, text: i.detail })) }]
      : [{ p: "Nothing in the report stands between this file and a first model." }],
  });

  const scoreBlocks = [{ table: {
    head: ["Dimension", "Score"],
    rows: Object.entries(healthScore.breakdown).map(([k, v]) => [
      { quality: "Quality", structure: "Structure", relationships: "Relationships", targetReadiness: "Target readiness" }[k] ?? k, String(v),
    ]),
  } }];
  if (healthScore.limits?.length) {
    scoreBlocks.push({ p: "Limits applied — the lowest one holds:" });
    scoreBlocks.push({ list: healthScore.limits.map((l) => ({ strong: `max ${l.max}.`, text: l.reason })) });
  }
  sections.push({ heading: `Health score — ${healthScore.score}/100 (${healthScore.grade})`, blocks: scoreBlocks });

  const issuesByCol = new Map();
  for (const c of quality.columnsWithIssues) {
    if (!issuesByCol.has(c.col)) issuesByCol.set(c.col, []);
    issuesByCol.get(c.col).push(c.issue === "missing" ? `${pct(c.count, meta.rows)} missing` : c.issue.replace(/_/g, " "));
  }
  sections.push({
    heading: "Columns",
    blocks: [{ table: {
      head: ["Column", "Role", "Notes"],
      rows: Object.entries(meta.columnRoles).map(([col, role]) => [
        col, col === meta.target ? `target (${role})` : role, (issuesByCol.get(col) ?? []).join("; ") || "—",
      ]),
    } }],
  });

  if (meta.target && !meta.targetIsConstant && !meta.targetIsIdentifier) {
    const assoc = Object.entries(relationships.targetCorrelations ?? {})
      .sort(([, a], [, b]) => (b.absValue ?? 0) - (a.absValue ?? 0))
      .slice(0, 15);
    const blocks = assoc.length
      ? [{ table: {
          head: ["Column", "Measure", "Value", "p-value", "Rows"],
          rows: assoc.map(([col, e]) => [col, METRIC[e.metric] ?? e.metric, num(e.value, 2),
            Number.isFinite(e.pValue) ? (e.pValue < 0.001 ? "<0.001" : num(e.pValue, 3)) : "—", e.n?.toLocaleString() ?? "—"]),
        } }]
      : [{ p: "No column could be scored against the target." }];
    if (diagnostic?.status === "ok") {
      const metric = diagnostic.metric === "balanced_accuracy" ? "balanced accuracy" : "R²";
      blocks.push({ p: `Baseline model (${diagnostic.folds}-fold cross-validation, ${diagnostic.split} split): ${num(diagnostic.model.mean)} ± ${num(diagnostic.model.sd)} in ${metric}, against ${num(diagnostic.baseline.mean)} for a know-nothing guess. `
        + (diagnostic.unstable ? "The folds disagree about the target's scale, so no verdict is given."
          : diagnostic.signal ? "The columns carry signal." : "No reliable signal.") });
    } else if (diagnostic?.reason) {
      blocks.push({ p: `Baseline model not run: ${diagnostic.reason}` });
    }
    sections.push({ heading: `Target signal — "${meta.target}" (${meta.datasetType})`, blocks });

    const plan = buildPrepPlan(result);
    if (plan.usable) {
      const kept = [
        ...plan.numeric.map((f) => [f.col, `numeric — impute ${f.impute.replace("_", " ")}${f.flag ? ", plus a was-missing flag" : ""}, then scale`]),
        ...plan.categorical.map((f) => [f.col, `categorical — impute most frequent${f.flag ? ", plus a was-missing flag" : ""}, then one-hot`]),
        ...plan.presence.map((col) => [col, "only whether it was recorded"]),
      ];
      sections.push({
        heading: "Preparation plan",
        blocks: [
          { p: `Split: ${plan.groupBy ? `grouped by "${plan.groupBy}"` : plan.stratify ? "stratified" : "random"}${plan.dropDuplicates ? ", after dropping duplicate rows" : ""}. Every statistic is learned on the training rows only.` },
          { table: { head: ["Column", "Step"], rows: kept } },
          ...(plan.excluded.length ? [{ p: "Left out:" }, { list: plan.excluded.map((e) => ({ strong: `${e.col}:`, text: e.reason })) }] : []),
        ],
      });
    }
  }

  if (recommendations?.length) {
    sections.push({
      heading: "Recommendations",
      blocks: [{ list: recommendations.map((r) => ({
        strong: `[${r.priority}] ${r.column ? `${r.column}: ` : ""}${r.issue}.`,
        text: `${r.action}${r.rationale ? ` — ${r.rationale}` : ""}`,
      })) }],
    });
  }

  return {
    title: `Vecto report${fileName ? ` — ${fileName}` : ""}`,
    subtitle: `Generated ${generatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC by Vecto (${SITE}). Every figure was computed in the browser; the methods are at ${SITE}/methodology.`,
    facts: [
      ["Target", meta.target ? `${meta.target} (${meta.datasetType})` : "none"],
      ["Rows", meta.rows.toLocaleString()],
      ["Columns", String(meta.columns)],
      ["Missing cells", `${quality.missingCells.toLocaleString()} (${quality.missingPct}%)`],
      ["Duplicate rows", quality.duplicateRows.toLocaleString()],
      ["Quality score", `${quality.qualityScore}/100`],
      ["Health score", `${healthScore.score}/100 (${healthScore.grade})`],
    ],
    sections,
  };
}

/* ── Markdown ─────────────────────────────────────────────────────────────── */
const mdCell = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");

export function toMarkdown(model) {
  const out = [`# ${model.title}`, "", `_${model.subtitle}_`, ""];
  out.push("| | |", "|---|---|", ...model.facts.map(([k, v]) => `| ${mdCell(k)} | ${mdCell(v)} |`), "");
  for (const s of model.sections) {
    out.push(`## ${s.heading}`, "");
    for (const b of s.blocks) {
      if (b.p) out.push(b.p, "");
      if (b.list) out.push(...b.list.map((i) => `- ${i.strong ? `**${i.strong}** ` : ""}${i.text}`), "");
      if (b.table) {
        out.push(`| ${b.table.head.map(mdCell).join(" | ")} |`, `|${b.table.head.map(() => "---").join("|")}|`,
          ...b.table.rows.map((r) => `| ${r.map(mdCell).join(" | ")} |`), "");
      }
    }
  }
  return out.join("\n");
}

/* ── HTML: one file, no scripts, no external requests, prints cleanly ─────── */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function toHtml(model) {
  const block = (b) => {
    if (b.p) return `<p>${esc(b.p)}</p>`;
    if (b.list) return `<ul>${b.list.map((i) => `<li>${i.strong ? `<strong>${esc(i.strong)}</strong> ` : ""}${esc(i.text)}</li>`).join("")}</ul>`;
    if (b.table) {
      return `<table><thead><tr>${b.table.head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${
        b.table.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    }
    return "";
  };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(model.title)}</title>
<style>
  body { font: 15px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; color: #16181d; background: #fff; max-width: 960px; margin: 40px auto; padding: 0 20px; }
  h1 { font-size: 26px; margin: 0 0 6px; } h2 { font-size: 18px; margin: 36px 0 10px; padding-top: 16px; border-top: 1px solid #e3e5ea; }
  .sub { color: #5c6270; font-size: 13px; margin: 0 0 20px; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0 14px; font-size: 13.5px; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #e3e5ea; vertical-align: top; }
  th { background: #f5f6f8; font-weight: 600; } td:first-child { font-family: ui-monospace, Menlo, monospace; font-size: 12.5px; }
  .facts td:first-child { font-family: inherit; color: #5c6270; width: 180px; }
  ul { padding-left: 20px; } li { margin: 6px 0; }
  @media print { body { margin: 0; } h2 { break-after: avoid; } tr { break-inside: avoid; } }
</style></head><body>
<h1>${esc(model.title)}</h1>
<p class="sub">${esc(model.subtitle)}</p>
<table class="facts"><tbody>${model.facts.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</tbody></table>
${model.sections.map((s) => `<h2>${esc(s.heading)}</h2>\n${s.blocks.map(block).join("\n")}`).join("\n")}
</body></html>
`;
}

/* ── JSON: the whole report, for tools — without the row preview ─────────── */
export function toJson(result, { fileName = null, generatedAt = new Date() } = {}) {
  // eslint-disable-next-line no-unused-vars
  const { snapshot, ...rest } = result;
  return JSON.stringify({
    vecto: { exportVersion: EXPORT_VERSION, generatedAt: generatedAt.toISOString(), fileName, site: SITE },
    readiness: buildReadiness(result),
    ...rest,
  }, null, 2);
}

/* ── Data dictionary: one row per column ─────────────────────────────────── */
const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function dataDictionaryCsv(result, rows) {
  const { meta, quality, statistics } = result;
  const stats = new Map((statistics ?? []).map((s) => [s.col, s]));
  const issues = new Map();
  for (const c of quality.columnsWithIssues) {
    if (c.issue === "missing") continue;
    if (!issues.has(c.col)) issues.set(c.col, []);
    issues.get(c.col).push(c.issue.replace(/_/g, " "));
  }
  const head = ["column", "role", "is_target", "present", "missing", "missing_pct", "distinct",
    "min", "median", "max", "mean", "top_values", "notes"];
  const lines = [head.join(",")];
  for (const [col, role] of Object.entries(meta.columnRoles)) {
    let present = 0;
    const counts = new Map();
    for (const r of rows ?? []) {
      const v = r[col];
      if (isMissing(v)) continue;
      present++;
      const key = normalizeValue(v);
      const hit = counts.get(key);
      if (hit) hit.n++;
      else counts.set(key, { value: String(v).trim(), n: 1 });
    }
    const missing = (rows?.length ?? meta.rows) - present;
    const s = stats.get(col);
    /* Top values only where they describe the column — a near-unique column's "top
       values" are single rows, and the file's content should not ride along. */
    const top = counts.size > 0 && counts.size <= 50
      ? [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 3).map((t) => `${maskPersonalData(t.value)} (${t.n})`).join("; ")
      : "";
    lines.push([
      col, role, col === meta.target ? "yes" : "no", present, missing, pct(missing, rows?.length ?? meta.rows),
      counts.size, s ? s.min : "", s ? s.median : "", s ? s.max : "", s ? s.mean : "", top,
      (issues.get(col) ?? []).join("; "),
    ].map(csvCell).join(","));
  }
  return lines.join("\n") + "\n";
}

/* A safe file-name stem from the uploaded name: "My data (v2).csv" → "my-data-v2". */
export function exportStem(fileName) {
  const base = String(fileName ?? "").replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `vecto-${base || "report"}`;
}
