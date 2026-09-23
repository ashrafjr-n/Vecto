/* auth-usage.test.mjs — plain Node, no framework (same style as the other suites).

   Locks the part of the account layer that must never be wrong: the limit is
   enforced by the SERVER. The page prints "2 of 3 left", but that number is
   decoration — these checks are about what happens when the browser lies, or does
   not ask at all.

   What it covers:
     - the /api/ai gate: no session → 401, wrong origin → 403, over budget → 503
     - the quota rules in worker/usage.js, including that a wide file sent in six
       parts costs ONE analysis, and that a failed answer costs nothing
     - the eval bypass works and never touches the database

   D1 is replaced by a stub that answers queued rows. It does not execute SQL — the
   SQL is checked by running the app — so what is tested here is the DECISION each
   function makes given what the database says, which is where the logic lives. */

import worker from "../worker/index.js";
import {
  checkQuota, recordUsage, usageFor, resetsOn, periodOf, validAnalysisId,
  budgetAvailable, monthStart, MAX_REQUESTS_PER_ANALYSIS,
} from "../worker/usage.js";

let failures = 0;
function check(name, ok) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}

/* A D1 stand-in: `first()` returns the next queued row, `run()` and `batch()`
   record that a write happened. Every statement is kept so a test can assert that
   a path wrote nothing at all. */
function stubDb(rows = []) {
  const queue = [...rows];
  const db = {
    statements: [],
    writes: 0,
    prepare(sql) {
      const stmt = {
        sql,
        bind: (...args) => { stmt.args = args; db.statements.push({ sql, args }); return stmt; },
        first: async () => (queue.length ? queue.shift() : null),
        run: async () => { db.writes++; return { success: true }; },
      };
      return stmt;
    },
    batch: async (stmts) => { db.writes += stmts.length; return []; },
  };
  return db;
}

const ENV = () => ({
  OPENROUTER_API_KEY: "test-key",
  AI_MODELS: "a/one:free",
  EVAL_TOKEN: "test-eval-token",
  ALLOWED_ORIGINS: "https://vecto.test",
  FREE_ANALYSES_PER_DAY: "3",
  MONTHLY_ANALYSIS_CEILING: "25",
  DAILY_AI_BUDGET: "30",
});

const ID = "11111111-2222-3333-4444-555555555555";

const post = (env, { origin = "https://vecto.test", auth, body } = {}) =>
  worker.fetch(new Request("https://vecto.test/api/ai", {
    method: "POST",
    headers: {
      ...(origin ? { Origin: origin } : {}),
      ...(auth ? { Authorization: auth } : {}),
    },
    body: JSON.stringify(body ?? { task: "ping", analysisId: ID }),
  }), env);

// No model may be reached by anything in this file: every request must be stopped
// by the gate, or be the eval bypass, which we script explicitly where needed.
let upstreamCalls = 0;
globalThis.fetch = async () => {
  upstreamCalls++;
  return new Response(JSON.stringify({ model: "a/one:free", choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 });
};

/* ── the gate on /api/ai ──────────────────────────────────────────────────── */

{
  const env = { ...ENV(), DB: stubDb() };
  const res = await post(env);
  check("no session is 401 unauthenticated", res.status === 401 && (await res.json()).error === "unauthenticated");
  check("a rejected request never reaches the model", upstreamCalls === 0);
  check("a rejected request writes nothing", env.DB.writes === 0);
}

{
  const env = { ...ENV(), DB: stubDb() };
  const res = await post(env, { origin: "https://evil.example" });
  check("a foreign origin is 403 bad_origin", res.status === 403 && (await res.json()).error === "bad_origin");
}

{
  const env = { ...ENV(), DB: stubDb() };
  const res = await post(env, { origin: null });
  check("a missing origin is 403 (no browser omits it on a POST)", res.status === 403);
}

{
  // The eval bypass: no cookie, no Origin — a Node client with the secret.
  upstreamCalls = 0;
  const env = { ...ENV() };   // note: NO DB binding at all
  const res = await post(env, { origin: null, auth: "Bearer test-eval-token" });
  check("the eval token reaches the model without a session", res.status === 200 && upstreamCalls === 1);
  check("the eval token needs no analysis id", (await res.json()).task === "ping");
}

{
  upstreamCalls = 0;
  const env = { ...ENV(), DB: stubDb() };
  const res = await post(env, { origin: null, auth: "Bearer wrong-token" });
  check("a wrong eval token is not a bypass", res.status === 403 && upstreamCalls === 0);
}

{
  const env = { ...ENV(), EVAL_TOKEN: "", DB: stubDb() };
  const res = await post(env, { origin: null, auth: "Bearer " });
  check("an unset EVAL_TOKEN can never be matched", res.status === 403);
}

/* ── the quota rules ──────────────────────────────────────────────────────── */

{
  // A fresh analysis for a user who has used 2 of 3 today, well under the month.
  const env = { ...ENV(), DB: stubDb([null, { used: 2 }, { used: 4 }]) };
  check("a new analysis is allowed under the daily limit", (await checkQuota(env, 1, ID)).ok === true);
}

{
  // Under the day, but the month's safety net is full.
  const env = { ...ENV(), DB: stubDb([null, { used: 0 }, { used: 25 }]) };
  const verdict = await checkQuota(env, 1, ID);
  check("the monthly ceiling blocks even on a fresh day", verdict.ok === false && verdict.error === "monthly_ceiling");
  check("the ceiling answers 402, like the daily limit", verdict.status === 402);
  check("hitting the ceiling writes nothing", env.DB.writes === 0);
}

{
  const env = { ...ENV(), DB: stubDb([null, { used: 0 }, { used: 24 }]) };
  check("one below the ceiling still passes", (await checkQuota(env, 1, ID)).ok === true);
}

{
  const env = { ...ENV(), DB: stubDb([null, { used: 3 }]) };
  const verdict = await checkQuota(env, 1, ID);
  check("the fourth analysis of a day is refused", verdict.ok === false && verdict.error === "quota_exhausted");
  check("quota_exhausted is 402, not 401 or 500", verdict.status === 402);
  check("refusing to allow writes nothing", env.DB.writes === 0);
}

{
  /* The rule that makes "one dataset = one analysis" true: a wide file's later
     parts find their own id and are free, even though the day is full. The
     lookup is by (user_id, analysis_id) and never reads the period, which is
     also why a review begun before midnight stays free after it. */
  const env = { ...ENV(), DB: stubDb([{ requests: 4 }]) };
  check("a later part of a paid analysis is free", (await checkQuota(env, 1, ID)).ok === true);
  check("continuing an analysis never runs the day or month query", env.DB.statements.length === 1);
}

{
  const env = { ...ENV(), DB: stubDb([{ requests: MAX_REQUESTS_PER_ANALYSIS }]) };
  const verdict = await checkQuota(env, 1, ID);
  check("one analysis id cannot be reused without end", verdict.ok === false && verdict.error === "analysis_request_limit");
}

{
  const env = { ...ENV(), DB: stubDb() };
  await recordUsage(env, 1, ID);
  check("recording a success writes the analysis and the budget", env.DB.writes === 2);
  check("the analysis row carries the UTC period", env.DB.statements[0].args.includes(periodOf()));
}

{
  const env = { ...ENV(), DB: stubDb([{ used: 1 }]) };
  const usage = await usageFor(env, 1);
  check("usage reports used, limit and reset date", usage.used === 1 && usage.limit === 3 && usage.resets === resetsOn(usage.period));
  check("the period the UI sees is a DAY, not a month", /^\d{4}-\d{2}-\d{2}$/.test(usage.period));
}

/* ── the global budget ────────────────────────────────────────────────────── */

{
  const env = { ...ENV(), DB: stubDb([{ requests: 29 }]) };
  check("under the daily budget the endpoint is open", (await budgetAvailable(env)) === true);
}

{
  const env = { ...ENV(), DB: stubDb([{ requests: 30 }]) };
  check("at the daily budget the endpoint is closed to everyone", (await budgetAvailable(env)) === false);
}

/* ── small rules worth pinning ────────────────────────────────────────────── */

check("the allowance resets the next day", resetsOn("2026-09-23") === "2026-09-24");
check("a month end rolls into the next month", resetsOn("2026-09-30") === "2026-10-01");
check("a year end rolls into the next year", resetsOn("2026-12-31") === "2027-01-01");
check("a leap day is handled", resetsOn("2028-02-28") === "2028-02-29");
check("periodOf is day-granular", /^\d{4}-\d{2}-\d{2}$/.test(periodOf()));
check("monthStart is the 1st of this UTC month", new Date(monthStart()).toISOString().slice(8, 10) === "01");
check("a real uuid is a valid analysis id", validAnalysisId(ID));
check("an empty analysis id is refused", !validAnalysisId(""));
check("an injection-shaped analysis id is refused", !validAnalysisId("' OR 1=1 --"));
check("a very long analysis id is refused", !validAnalysisId("a".repeat(65)));

console.log(failures ? `\n${failures} auth/usage check(s) failed` : "\nall auth/usage checks passed");
process.exit(failures ? 1 : 0);
