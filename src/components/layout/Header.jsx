import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { ChevronDown } from "lucide-react";

import { useSession } from "../auth/sessionContext.js";

/* Fixed, full-width, edge-to-edge — NOT floating/pill-shaped. See frontend.md
   "Header" spec. Shared by every page (Home + Methodology + the /analyze flow).

   The bar wears the PANEL surface, not the canvas: every page opens on a
   paper-sunken hero, so the header reads as the top edge of that panel rather
   than a darker strip laid over it. Side padding matches the pages' own
   (px-6 / sm:px-10, OUTSIDE the 1400px box, as the page sections do), so the
   logo sits on the same left edge as the content at every width. */
/* About is the one link that gives way on a phone: it is also in the footer, and
   the bar has to fit the wordmark, Methodology and Sign in at 375px. */
const NAV = [
  { to: "/methodology", label: "Methodology" },
  { to: "/about",       label: "About", wide: true },
];

function Header() {
  const navigate = useNavigate();

  return (
    <header className="fixed top-0 left-0 z-50 h-16 w-full border-b border-line bg-paper-sunken/85 px-6 backdrop-blur sm:px-10">
      <div className="mx-auto flex h-full max-w-[1400px] items-center justify-between">

        <nav aria-label="Primary" className="flex items-center gap-4 sm:gap-7">
          <button
            type="button"
            onClick={() => { window.scrollTo(0, 0); navigate("/"); }}
            aria-label="Vecto home"
            className="flex items-center"
          >
            {/* Wordmark, not a symbol — it carries the name, so no text sits beside it.
                White artwork: legible only because every page renders in `.night`. */}
            <img src="/vecto-logo.png" alt="Vecto" width={538} height={238} className="h-9 w-auto sm:h-10" />
          </button>

          <span aria-hidden="true" className="hidden h-5 w-px bg-line-strong sm:block" />

          {/* scrollTo in the handler: BrowserRouter keeps the previous page's
              scroll position, which would open a long page halfway down. */}
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => window.scrollTo(0, 0)}
              className={({ isActive }) =>
                `${item.wide ? "hidden sm:inline" : ""} text-[13px] font-medium transition-colors ${isActive ? "text-ink" : "text-ink-soft hover:text-ink"}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <AccountMenu />

      </div>
    </header>
  );
}

/* Sign in, or who is signed in. Signing in opens a POPUP — the header is on every
   page including the report, and a full-page redirect there would destroy the
   parsed dataset and the built report, both of which live only in memory.

   The menu is a native <details>: focusable, keyboard-operable and open/closed
   without a line of state. It stays open until clicked again, which is the one
   thing a hand-rolled dropdown would do better and not worth the code. */
function AccountMenu() {
  const { user, usage, loading, signIn, signOut, deleteAccount } = useSession();
  /* Past analyses, loaded the first time the menu is opened — in the handler for
     the click that asked for them, not in an effect (reactjs-principles.md §6),
     and never for a visitor who never opens the menu. `null` is "not asked yet". */
  const [history, setHistory] = useState(null);

  const loadHistory = () => {
    if (history) return;
    fetch("/api/history", { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : { analyses: [] }))
      .catch(() => ({ analyses: [] }))
      .then((data) => setHistory(data.analyses ?? []));
  };

  // Nothing during the first load, so the bar does not flash "Sign in" at someone
  // who is already signed in.
  if (loading) return <div className="h-9 w-20" aria-hidden />;

  if (!user) {
    return (
      <button
        type="button"
        onClick={signIn}
        className="rounded-lg bg-ink px-4 py-2 text-[13px] font-semibold text-paper transition-opacity hover:opacity-90"
      >
        Sign in
      </button>
    );
  }

  const handleDelete = async () => {
    /* A plain confirm, by the owner's decision: this is destructive and rare, and
       a dedicated page would be more ceremony than the action deserves today. */
    if (!window.confirm("Delete your Vecto account? Your sign-in and your AI usage history are removed. This cannot be undone.")) return;
    if (!(await deleteAccount())) window.alert("The account could not be deleted. Please try again.");
  };

  return (
    <details className="relative" onToggle={(e) => { if (e.currentTarget.open) loadHistory(); }}>
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg border border-line-strong px-2.5 py-1.5 text-[13px] font-medium text-ink transition-colors hover:border-ink-faint [&::-webkit-details-marker]:hidden">
        {user.avatarUrl && (
          <img src={user.avatarUrl} alt="" width={20} height={20} className="h-5 w-5 rounded-full" />
        )}
        <span className="hidden sm:inline">{user.login}</span>
        <ChevronDown size={13} className="text-ink-faint" />
      </summary>

      <div className="absolute right-0 z-50 mt-2 w-[19rem] rounded-xl border border-line bg-paper-sunken p-3 shadow-lg">
        <p className="px-1 text-[12.5px] leading-relaxed text-ink-soft">
          {usage
            ? <>{Math.max(0, usage.limit - usage.used)} of {usage.limit} deeper reviews left today. Resets {usage.resets}.</>
            : "Signed in."}
        </p>

        {/* History, in the menu rather than on a page of its own: it is two counts
            and a date per analysis, which is a panel's worth of content and not a
            destination. It cannot reopen a report — the file was never stored. */}
        <div className="mt-3 border-t border-line pt-2">
          <p className="px-1 text-[11.5px] uppercase tracking-[0.06em] text-ink-faint">Past analyses</p>
          {history === null ? (
            <p className="px-1 py-2 text-[12.5px] text-ink-faint">Loading…</p>
          ) : history.length === 0 ? (
            <p className="px-1 py-2 text-[12.5px] leading-relaxed text-ink-faint">
              Nothing yet. An analysis appears here once a deeper review has run on it;
              reports you read without one are not recorded.
            </p>
          ) : (
            <dl className="mt-1 max-h-52 overflow-y-auto">
              {history.map((entry) => (
                <div key={entry.analysisId} className="flex items-baseline justify-between gap-3 px-1 py-1.5">
                  <dt className="font-mono text-[12px] text-ink">
                    {entry.rows === null ? "—" : `${entry.rows.toLocaleString()} rows`}
                    {entry.columns !== null && ` · ${entry.columns} cols`}
                  </dt>
                  <dd className="shrink-0 text-[11.5px] text-ink-faint">
                    {new Date(entry.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        <div className="mt-2 border-t border-line pt-2">
          <button type="button" onClick={signOut} className="w-full rounded-lg px-1 py-1.5 text-left text-[13px] text-ink transition-colors hover:bg-paper">
            Sign out
          </button>
          <button type="button" onClick={handleDelete} className="w-full rounded-lg px-1 py-1.5 text-left text-[13px] text-critical transition-colors hover:bg-paper">
            Delete account
          </button>
        </div>
      </div>
    </details>
  );
}

export default Header;
