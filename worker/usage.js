/* Free-tier accounting for the AI endpoint. Two limits, both server-side, because
   the number the page shows is decoration and the browser can say anything.

   1. PER USER — a free account gets FREE_ANALYSES_PER_MONTH *analyses*, not
      requests. One dataset is one analysis whatever it costs: the column review of
      a 150-column file is 6 parts plus a leakage call, and charging a user six
      times for one file would be indefensible. The client sends one analysis id
      per dataset and every request carrying it after the first is free.

   2. GLOBALLY — DAILY_AI_BUDGET requests a day across every user. This is the one
      that actually bounds the upstream bill: accounts are free to create, so a
      per-user limit bounds nobody. Eval traffic records here but is never blocked
      by it (see worker/index.js), or public traffic could lock the owner out of
      his own measurements.

   Usage is recorded only after a SUCCESSFUL answer. A provider failure costs
   nothing upstream and must never cost a user one of their three. */

/* The largest legitimate analysis is 6 review parts (DOSSIER_MAX_COLUMNS 150 /
   DOSSIER_PART_COLUMNS 25) plus one leakage call = 7. Ten leaves room for a retry
   after an error and still caps what one analysis id can ever be worth. */
export const MAX_REQUESTS_PER_ANALYSIS = 10;

const DEFAULT_FREE_ANALYSES = 3;
const DEFAULT_DAILY_BUDGET = 30;

const num = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export const freeAnalyses = (env) => num(env.FREE_ANALYSES_PER_MONTH, DEFAULT_FREE_ANALYSES);
export const dailyBudget  = (env) => num(env.DAILY_AI_BUDGET, DEFAULT_DAILY_BUDGET);

/* 'YYYY-MM' and 'YYYY-MM-DD' in UTC. The period is a KEY, not a countdown: a new
   month simply has no rows yet, so nothing has to run to "reset" anything. */
export const periodOf = (now = new Date()) => now.toISOString().slice(0, 7);
export const dayOf    = (now = new Date()) => now.toISOString().slice(0, 10);

/* First day of the month after this one, as 'YYYY-MM-DD' — shown to the user as
   when their free analyses come back. Derived, never stored. */
export function resetsOn(period) {
  const [year, month] = period.split("-").map(Number);
  return month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

/* The client generates this (crypto.randomUUID). It is only ever used as a key
   scoped to one user, so it needs to be well-formed, not unguessable. */
export const validAnalysisId = (id) => typeof id === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(id);

export async function usageFor(env, userId) {
  const period = periodOf();
  const row = await env.DB
    .prepare("SELECT COUNT(*) AS used FROM analyses WHERE user_id = ? AND period = ?")
    .bind(userId, period)
    .first();
  return {
    used:   row?.used ?? 0,
    limit:  freeAnalyses(env),
    period,
    resets: resetsOn(period),
  };
}

/* May this request go to the model? → { ok: true } | { ok: false, error, status }.
   Nothing is written here: a request that is allowed but then fails upstream must
   leave no trace. */
export async function checkQuota(env, userId, analysisId) {
  const existing = await env.DB
    .prepare("SELECT requests FROM analyses WHERE user_id = ? AND analysis_id = ?")
    .bind(userId, analysisId)
    .first();

  if (existing) {
    // Already paid for. Free until the ceiling, which no real file reaches.
    return existing.requests >= MAX_REQUESTS_PER_ANALYSIS
      ? { ok: false, error: "analysis_request_limit", status: 429 }
      : { ok: true };
  }

  const { used, limit } = await usageFor(env, userId);
  if (used >= limit) return { ok: false, error: "quota_exhausted", status: 402 };
  return { ok: true };
}

/* After a successful answer: charge the analysis (creating it on first use) and
   count the request globally. Two statements, not a transaction — the worst case
   if the second fails is that the global counter runs one behind, which is not
   worth a transaction on D1's free tier. */
export async function recordUsage(env, userId, analysisId) {
  const now = Date.now();
  await env.DB
    .prepare(`INSERT INTO analyses (user_id, analysis_id, period, requests, created_at)
              VALUES (?, ?, ?, 1, ?)
              ON CONFLICT(user_id, analysis_id) DO UPDATE SET requests = requests + 1`)
    .bind(userId, analysisId, periodOf(), now)
    .run();
  await recordBudget(env);
}

export async function budgetSpent(env) {
  const row = await env.DB
    .prepare("SELECT requests FROM budget WHERE day = ?")
    .bind(dayOf())
    .first();
  return row?.requests ?? 0;
}

export async function budgetAvailable(env) {
  return (await budgetSpent(env)) < dailyBudget(env);
}

export async function recordBudget(env) {
  await env.DB
    .prepare(`INSERT INTO budget (day, requests) VALUES (?, 1)
              ON CONFLICT(day) DO UPDATE SET requests = requests + 1`)
    .bind(dayOf())
    .run();
}
