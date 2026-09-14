/* Plan and explainer (AI phase E) — the pure halves around the model call.

   buildPlanPayload() sends what the report already says: the health score and the
   caps that held it, every recommendation with a stable id, the insight cards, and
   the decisions the user made (accepted roles, cleaning rules, the leakage review).

   verifyPlan() holds the model to it:
     - a step must reference at least one real recommendation id, or it is dropped;
     - every number written in the summary or a step must occur in the payload —
       a sentence with a number the report does not contain is REMOVED and listed.
       That is the one guard against a fluent "your data is 87% clean";
     - high-priority recommendations the plan left out are listed, so an ordering
       can never quietly hide one. */

import { PLAN_SUMMARY_MAX_WORDS } from "./planSchema.js";

const compact = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0)));
const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

export const recommendationId = (index) => `R${index + 1}`;

export function buildPlanPayload(result, { cleaningRules = [], leakageReview = null } = {}) {
  const { meta, healthScore, recommendations, insights } = result;
  return {
    schemaVersion: 1,
    dataset: compact({ rows: meta.rows, columns: meta.columns, target: meta.target ?? undefined, taskType: meta.target ? meta.datasetType : undefined }),
    health: healthScore ? { score: healthScore.score, grade: healthScore.grade, limits: (healthScore.limits ?? []).map((l) => l.reason) } : null,
    recommendations: (recommendations ?? []).map((r, i) => compact({
      id: recommendationId(i),
      priority: r.priority,
      category: r.category,
      column: r.column ?? undefined,
      issue: r.issue,
      action: r.action,
      rationale: r.rationale,
    })),
    insights: (insights ?? []).map((i) => ({ severity: i.severity, title: i.title, text: i.text })),
    decisions: compact({
      roleOverrides: Object.entries(meta.roleOverrides ?? {}).map(([col, o]) => `${col}: ${o.from} → ${o.to}`),
      cleaningRules: cleaningRules.map((r) => `${r.column}: ${r.type}`),
      leakageReview: (leakageReview?.findings ?? []).map((f) => `${f.column}: ${f.category} (${f.verdict})`),
    }),
  };
}


/* ── Number grounding ─────────────────────────────────────────────────────── */

/* Numbers as a reader sees them: "2,873", "77.1%", "-0.54". A digit glued to a
   letter or an underscore ("R3", "fc_2") is part of a name, not a number. */
const NUMBER_TOKEN = /(?<![\p{L}\d_.])-?\d[\d,]*(?:\.\d+)?(?![\p{L}\d_])/gu;
const toValue = (token) => parseFloat(token.replace(/,/g, ""));

export function numbersIn(textValue) {
  return [...String(textValue).matchAll(NUMBER_TOKEN)].map((m) => ({ token: m[0], value: toValue(m[0]) }));
}

/* ponytail: whole numbers 0–10 always pass — "two steps", "3 columns", step
   ordinals — so a small invented count can slip through; everything larger must
   be in the report. A report value matches when it rounds to what was written, or
   when a share (0.958) is written as a percentage (95.8). */
function groundedBy(allowed) {
  return (value) => {
    if (Number.isInteger(value) && Math.abs(value) <= 10) return true;
    for (const a of allowed) {
      if (Math.abs(a - value) <= Math.max(0.051, 0.005 * Math.abs(a))) return true;
      if (Math.round(a) === value) return true;
      if (Math.abs(a) <= 1 && Math.abs(a * 100 - value) <= 0.051) return true;
    }
    return false;
  };
}

const sentencesOf = (value) => value.split(/(?<=[.!?])\s+/).filter(Boolean);


/* ── Verification ─────────────────────────────────────────────────────────── */

/* → { summary, steps, removed, withheld, notInPlan, summaryWords } or { error }. */
export function verifyPlan(answer, payload) {
  if (!answer || typeof answer.summary !== "string" || !Array.isArray(answer.steps)) {
    return { error: "The model's answer did not have the expected shape." };
  }
  const allowed = numbersIn(JSON.stringify(payload)).map((n) => n.value);
  const isGrounded = groundedBy(allowed);
  const recs = new Map(payload.recommendations.map((r) => [r.id, r]));
  const removed = [];
  const withheld = [];

  const ground = (value, where) => sentencesOf(value).filter((sentence) => {
    const bad = numbersIn(sentence).find((n) => !isGrounded(n.value));
    if (bad) removed.push({ where, sentence, number: bad.token });
    return !bad;
  }).join(" ");

  const summary = ground(text(answer.summary, 3000), "summary");
  const steps = [];
  const covered = new Set();
  answer.steps.forEach((s, i) => {
    const ids = [...new Set((Array.isArray(s?.recommendationIds) ? s.recommendationIds : []).filter((id) => typeof id === "string"))];
    const unknown = ids.filter((id) => !recs.has(id));
    if (unknown.length) withheld.push({ step: i + 1, reason: `${unknown.join(", ")} not a recommendation in this report` });
    const valid = ids.filter((id) => recs.has(id));
    if (!valid.length) {
      withheld.push({ step: i + 1, reason: "the step references no recommendation in this report" });
      return;
    }
    valid.forEach((id) => covered.add(id));
    const title = ground(text(s.title, 200), `step ${i + 1} title`) || recs.get(valid[0]).issue;
    steps.push({ title, why: ground(text(s.why, 800), `step ${i + 1}`), recommendationIds: valid });
  });

  return {
    summary,
    steps,
    removed,
    withheld,
    notInPlan: payload.recommendations.filter((r) => r.priority === "high" && !covered.has(r.id)).map((r) => r.id),
    summaryWords: summary ? summary.split(/\s+/).length : 0,
    summaryTooLong: summary.split(/\s+/).length > PLAN_SUMMARY_MAX_WORDS,
  };
}
