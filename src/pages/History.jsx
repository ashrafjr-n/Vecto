import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import Header from "../components/layout/Header.jsx";
import Footer from "../components/layout/Footer.jsx";
import { useSession } from "../components/auth/sessionContext.js";

/* What you have run, for a signed-in account.

   Counts and dates, and nothing else. There is no filename, no column name and no
   target here because none of them is stored: Vecto never receives the file, and
   retaining the schema of someone's data is a different promise from the one this
   product makes. That is also why an entry cannot reopen a report — the numbers to
   rebuild it were never kept. Re-analysing the file takes one drop and no account.

   See migrations/0002_history.sql for the fields and why the absent ones are absent. */
function History() {
  const { user, loading } = useSession();
  const [state, setState] = useState({ status: "loading", analyses: [] });

  /* Synchronising with the server — the one thing useEffect is for. Runs when the
     session settles, so it does not fetch before we know whether anyone is signed in. */
  useEffect(() => {
    if (loading || !user) return undefined;
    let alive = true;
    fetch("/api/history", { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : { analyses: [] }))
      .catch(() => ({ analyses: [] }))
      .then((data) => {
        if (!alive) return;
        setState({ status: "ready", analyses: data.analyses ?? [] });
      });
    return () => { alive = false; };
  }, [loading, user]);

  return (
    <div className="night min-h-screen bg-paper text-ink">
      <title>History · Vecto</title>
      <Header />

      <main className="px-6 pt-24 pb-24 sm:px-10 sm:pt-28">
        <div className="mx-auto max-w-[900px]">
          <div className="text-[13px] font-medium text-ink-faint">Account</div>
          <h1 className="mt-6 text-[2rem] font-semibold leading-[1.05] tracking-[-0.03em] text-ink sm:text-[2.5rem]">
            History
          </h1>
          <p className="mt-5 max-w-2xl text-[15px] leading-[1.75] text-ink-soft">
            The analyses this account has run. Vecto keeps the date and the size of each
            one — never the file, its values, its column names or the target, none of which
            it stores.
          </p>

          {!loading && !user && (
            <p className="mt-12 border-t border-line pt-8 text-[14px] text-ink-soft">
              Sign in to see your history.{" "}
              <Link to="/" className="underline decoration-line-strong underline-offset-4 hover:text-ink">
                Analyze a dataset
              </Link>
            </p>
          )}

          {user && state.status === "ready" && state.analyses.length === 0 && (
            <p className="mt-12 border-t border-line pt-8 text-[14px] text-ink-soft">
              Nothing here yet. An analysis appears once you have run a deeper review on it —
              reports you read without one are not recorded.
            </p>
          )}

          {user && state.analyses.length > 0 && (
            <dl className="mt-12 border-t border-line">
              {state.analyses.map((entry) => (
                <div
                  key={entry.analysisId}
                  className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1.5 border-b border-line py-4"
                >
                  <dt className="font-mono text-[13px] text-ink">
                    {entry.rows === null ? "—" : `${entry.rows.toLocaleString()} rows`}
                    {entry.columns !== null && ` · ${entry.columns} columns`}
                  </dt>
                  <dd className="text-[13px] text-ink-faint">
                    {new Date(entry.createdAt).toLocaleDateString(undefined, {
                      year: "numeric", month: "short", day: "numeric",
                    })}
                    {entry.reviewed && " · reviewed"}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}

export default History;
