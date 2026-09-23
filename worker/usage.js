/* Free-tier accounting for the AI endpoint. Two limits, both server-side, because
   the number the page shows is decoration and the browser can say anything.

   1. PER USER — an account gets FREE_ANALYSES_PER_DAY *analyses*, not requests,
      with MONTHLY_ANALYSIS_CEILING behind it as a safety net. One dataset is one
      analysis whatever it costs: the column review of a 150-column file is 6 parts
      plus a leakage call, and charging a user six times for one file would be
      indefensible. The client sends one analysis id per dataset and every request
      carrying it after the first is free — including across midnight, because the
      lookup is by id and never reads the period.

   2. GLOBALLY — DAILY_AI_BUDGET requests a day across every user. This is the one
      that actually bounds the upstream bill: accounts are free to create, so a
      per-user limit bounds nobody. Eval traffic records here but is never blocked
      by it (see worker/index.js), or public traffic could lock the owner out of
      his own measurements.

   Usage is recorded only after a SUCCESSFUL answer. A provider failure costs
   nothing upstream and must never cost a user one of their allowance. */

/* The largest legitimate analysis is 6 review parts (DOSSIER_MAX_COLUMNS 150 /
   DOSSIER_PART_COLUMNS 25) plus one leakage call = 7. Ten leaves room for a retry
   after an error and still caps what one analysis id can ever be worth. */
export const MAX_REQUESTS_PER_ANALYSIS = 10;

const DEFAULT_FREE_ANALYSES = 3;      // per DAY, per user
const DEFAULT_MONTHLY_CEILING = 25;   // per user, a safety net rather than a UX number
const DEFAULT_DAILY_BUDGET = 30;      // all users together — the real cost bound

const num = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export const freeAnalyses   = (env) => num(env.FREE_ANALYSES_PER_DAY, DEFAULT_FREE_ANALYSES);
export const monthlyCeiling = (env) => num(env.MONTHLY_ANALYSIS_CEILING, DEFAULT_MONTHLY_CEILING);
export const dailyBudget    = (env) => num(env.DAILY_AI_BUDGET, DEFAULT_DAILY_BUDGET);

/* 'YYYY-MM-DD' in UTC. The period is a KEY, not a countdown: a new day simply has
   no rows yet, so nothing has to run to "reset" anything.

   `periodOf` was month-granularity until 2026-09-23. Only the string it produces
   changed — the rule that an EXISTING analysis id stays free is keyed on
   (user_id, analysis_id) and never looks at the period, so a review begun at
   23:58 and continued at 00:02 is still the same analysis and is still free. */
export const periodOf = (now = new Date()) => now.toISOString().slice(0, 10);
export const dayOf    = (now = new Date()) => now.toISOString().slice(0, 10);

/* The day after this one, as 'YYYY-MM-DD' — when the allowance comes back.
   Derived, never stored. Date handles month and year ends. */
export function resetsOn(period) {
  const next = new Date(`${period}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/* Start of the current UTC month as a millisecond timestamp, for the monthly
   ceiling. `analyses.created_at` already holds a timestamp, so the ceiling needs
   no new column and no second counter that could drift from the first. */
export function monthStart(now = new Date()) {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
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

  /* A safety net behind the daily allowance, not a number the UI leads with: a
     daily reset alone would let one account draw 3 × 30 a month for ever. Counted
     off `created_at`, so it needs no column of its own and cannot drift from the
     daily count — they read the same rows. */
  const ceiling = monthlyCeiling(env);
  const month = await env.DB
    .prepare("SELECT COUNT(*) AS used FROM analyses WHERE user_id = ? AND created_at >= ?")
    .bind(userId, monthStart())
    .first();
  if ((month?.used ?? 0) >= ceiling) return { ok: false, error: "monthly_ceiling", status: 402 };

  return { ok: true };
}

/* After a successful answer: charge the analysis (creating it on first use) and
   count the request globally. Two statements, not a transaction — the worst case
   if the second fails is that the global counter runs one behind, which is not
   worth a transaction on D1's free tier. */
export async function recordUsage(env, userId, analysisId, meta = {}) {
  const now = Date.now();
  /* `rows` and `columns` are for History and are read out of the payload the
     request already carried — nothing new is sent for them. The upsert writes
     them once, on the row's creation: a later part of the same analysis must not
     overwrite the first writer's counts (a split part profiles 25 columns, not
     the file's real width), which is what COALESCE on the existing value does. */
  await env.DB
    .prepare(`INSERT INTO analyses (user_id, analysis_id, period, requests, created_at, rows, columns)
              VALUES (?, ?, ?, 1, ?, ?, ?)
              ON CONFLICT(user_id, analysis_id) DO UPDATE SET
                requests = requests + 1,
                rows     = COALESCE(analyses.rows, excluded.rows),
                columns  = COALESCE(analyses.columns, excluded.columns)`)
    .bind(userId, analysisId, periodOf(), now, meta.rows ?? null, meta.columns ?? null)
    .run();
  await recordBudget(env);
}

/* The signed-in user's own analyses, newest first. Counts and timestamps only —
   see migrations/0002_history.sql for what is deliberately absent. */
export async function historyFor(env, userId, limit = 20) {
  const { results } = await env.DB
    .prepare(`SELECT analysis_id, created_at, rows, columns
              FROM analyses WHERE user_id = ?
              ORDER BY created_at DESC LIMIT ?`)
    .bind(userId, limit)
    .all();
  /* No "reviewed" flag: a row exists only because `recordUsage` ran, and that only
     runs after a successful answer, so every row here IS a deeper review. A field
     that is true on every row tells the reader nothing. */
  return (results ?? []).map((r) => ({
    analysisId: r.analysis_id,
    createdAt:  r.created_at,
    rows:       r.rows,
    columns:    r.columns,
  }));
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
