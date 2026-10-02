/* quota-sql.test.mjs — the quota SQL, EXECUTED. auth-usage.test.mjs checks the
   decisions against a stub that answers queued rows; this file runs the real
   statements in worker/usage.js against SQLite (node:sqlite, built into Node 22 —
   D1 is SQLite) with the real migrations, because the rule that matters here lives
   in the SQL itself: N requests sent at once must not all take the last slot. */

import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { claimQuota, releaseAnalysis, recordUsage, usageFor, historyFor, PENDING_MS } from "../worker/usage.js";

let failures = 0;
function check(name, ok) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}

/* The slice of D1's API usage.js calls, over a real database. Each call yields to the
   event loop first, so requests started together interleave between statements
   exactly as concurrent Worker requests do against D1. */
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of ["migrations/0001_init.sql", "migrations/0002_history.sql"]) db.exec(readFileSync(f, "utf8"));
  db.exec("INSERT INTO users (github_id, login, created_at) VALUES (1, 'u', 0)");
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return {
    raw: db,
    prepare: (sql) => {
      let args = [];
      const stmt = {
        bind: (...a) => { args = a; return stmt; },
        first: async () => { await tick(); return db.prepare(sql).get(...args) ?? null; },
        run: async () => { await tick(); const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
        all: async () => { await tick(); return { results: db.prepare(sql).all(...args) }; },
      };
      return stmt;
    },
  };
}

const ENV = (DB) => ({ DB, FREE_ANALYSES_PER_DAY: "3", MONTHLY_ANALYSIS_CEILING: "25" });
const id = (n) => `analysis-${String(n).padStart(4, "0")}`;

{
  /* The defect: a check before the call and a charge after it let every request in
     a burst pass while none had been charged yet. */
  const env = ENV(d1());
  const verdicts = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map((n) => claimQuota(env, 1, id(n))));
  const passed = verdicts.filter((v) => v.ok).length;
  check("eight new analyses sent at once: exactly three pass", passed === 3);
  check("the rest are refused as quota_exhausted",
    verdicts.filter((v) => !v.ok).every((v) => v.error === "quota_exhausted" && v.status === 402));
  check("the reservations count in the user's usage at once", (await usageFor(env, 1)).used === 3);
}

{
  // A wide file: every part carries the same id and the first claim pays for all of them.
  const env = ENV(d1());
  const verdicts = await Promise.all([1, 2, 3, 4, 5, 6].map(() => claimQuota(env, 1, id(1))));
  check("six parts of one analysis sent at once all pass", verdicts.every((v) => v.ok));
  check("exactly one of them owns the reservation", verdicts.filter((v) => v.created).length === 1);
  check("they cost one analysis", (await usageFor(env, 1)).used === 1);
}

{
  // A failed answer gives the slot back; a sibling part's success keeps it paid.
  const env = ENV(d1());
  await claimQuota(env, 1, id(1));
  await releaseAnalysis(env, 1, id(1));
  check("a released reservation costs nothing", (await usageFor(env, 1)).used === 0);

  await claimQuota(env, 1, id(2));
  await recordUsage(env, 1, id(2), { rows: 891, columns: 12 });
  await releaseAnalysis(env, 1, id(2));
  check("a release never removes an analysis that was answered", (await usageFor(env, 1)).used === 1);
  const [entry] = await historyFor(env, 1);
  check("an answered reservation becomes one History entry with its counts",
    entry?.analysisId === id(2) && entry.rows === 891 && entry.columns === 12);
}

{
  // A request whose Worker was cancelled leaves its reservation behind.
  const env = ENV(d1());
  await claimQuota(env, 1, id(1));
  check("a reservation in flight is not in History", (await historyFor(env, 1)).length === 0);
  env.DB.raw.prepare("UPDATE analyses SET created_at = ?").run(Date.now() - PENDING_MS - 1000);
  check("an abandoned reservation stops counting", (await usageFor(env, 1)).used === 0);

  // ...and cannot be used to skip the limit later: re-using its id is claimed afresh.
  await Promise.all([2, 3, 4].map((n) => claimQuota(env, 1, id(n))));
  const reuse = await claimQuota(env, 1, id(1));
  check("an abandoned id re-used on a full day is refused", !reuse.ok && reuse.error === "quota_exhausted");
}

{
  const env = ENV(d1());
  const now = Date.now();
  // 25 answered analyses earlier this month, none of them today.
  const old = new Date(now); old.setUTCDate(1); old.setUTCHours(0, 0, 0, 0);
  const insert = env.DB.raw.prepare("INSERT INTO analyses (user_id, analysis_id, period, requests, created_at) VALUES (1, ?, 'earlier', 1, ?)");
  for (let n = 0; n < 25; n++) insert.run(`month-${n}`, old.getTime() + n);
  // Their period is not today's, so the day is empty and only the month can refuse.
  const verdict = await claimQuota(env, 1, id(1));
  check("the monthly ceiling refuses a fresh day's first analysis", !verdict.ok && verdict.error === "monthly_ceiling");
}

console.log(failures ? `\n${failures} quota SQL check(s) failed` : "\nall quota SQL checks passed");
process.exit(failures ? 1 : 0);
