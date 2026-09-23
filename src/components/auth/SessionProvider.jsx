import { useCallback, useEffect, useMemo, useState } from "react";

import { SessionContext } from "./sessionContext.js";

/* Who is signed in, and how much of the free AI allowance is left.

   Context, which this project otherwise avoids, for the reason
   reactjs-principles.md §4 names as the legitimate one: a rarely-changing value
   needed by distant components — the header and the three AI panels. Two copies
   of this state would disagree the moment someone signs in from one of them.

   Nothing here is trusted. The server decides every limit; `usage` is what the UI
   prints, and printing a wrong number is the worst it can do. */

const EMPTY = { user: null, usage: null };

export function SessionProvider({ children }) {
  const [session, setSession] = useState(EMPTY);
  const [loading, setLoading] = useState(true);

  /* Synchronising with something outside React — the one thing useEffect is for.
     Runs once; `alive` stops a late reply writing into an unmounted tree. */
  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me", { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : EMPTY))
      .catch(() => EMPTY)
      .then((data) => {
        if (!alive) return;
        setSession({ user: data?.user ?? null, usage: data?.usage ?? null });
        setLoading(false);
      });
    return () => { alive = false; };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "same-origin" });
      const data = res.ok ? await res.json() : EMPTY;
      setSession({ user: data?.user ?? null, usage: data?.usage ?? null });
    } catch {
      /* Offline or the endpoint is down: keep showing what we had. The server is
         still the thing enforcing the limit, so a stale count is harmless. */
    }
  }, []);

  /* A POPUP, not a redirect. A full-page OAuth redirect would unload this
     document, and the parsed dataset (lib/datasetHandoff.js is a module variable)
     and the built report (Analyze.jsx state) live only in its memory — signing in
     from the report would silently destroy the user's work. */
  const signIn = useCallback(() => new Promise((resolve) => {
    const popup = window.open("/api/auth/github", "vecto-auth", "width=980,height=720");
    if (!popup) { resolve({ ok: false, blocked: true }); return; }

    const onMessage = (event) => {
      // Only our own callback page may report the result of a sign-in.
      if (event.origin !== window.location.origin) return;
      if (event.data?.source !== "vecto-auth") return;
      window.removeEventListener("message", onMessage);
      clearInterval(poll);
      refresh().then(() => resolve({ ok: Boolean(event.data.ok) }));
    };
    window.addEventListener("message", onMessage);

    /* The window can also be closed by hand, which sends no message. Poll for
       that so the promise always settles and the UI never hangs on "signing in". */
    const poll = setInterval(() => {
      if (!popup.closed) return;
      clearInterval(poll);
      window.removeEventListener("message", onMessage);
      refresh().then(() => resolve({ ok: false, closed: true }));
    }, 500);
  }), [refresh]);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
    setSession(EMPTY);
  }, []);

  const deleteAccount = useCallback(async () => {
    const res = await fetch("/api/auth/delete", { method: "POST", credentials: "same-origin" }).catch(() => null);
    if (res?.ok) setSession(EMPTY);
    return Boolean(res?.ok);
  }, []);

  /* The Worker returns the new usage with every successful AI answer, so the
     counter moves without a second round trip. */
  const applyUsage = useCallback((usage) => {
    if (usage) setSession((prev) => ({ ...prev, usage }));
  }, []);

  const value = useMemo(
    () => ({ ...session, loading, signIn, signOut, deleteAccount, refresh, applyUsage }),
    [session, loading, signIn, signOut, deleteAccount, refresh, applyUsage],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
