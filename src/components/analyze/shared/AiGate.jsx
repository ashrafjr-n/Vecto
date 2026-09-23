import { Link } from "react-router-dom";

import { useSession, hasQuota } from "../../auth/sessionContext.js";

/* What stands between an AI panel's explanation and its button.

   Three states, one place, so the target picker, the Quality tab and the Target
   Signal tab cannot drift into saying different things about the same account:

     signed out  → a sign-in button, and the line that the rest of the report
                   needs no account (it is the thing people most need to hear)
     no quota    → the panel's button is withheld, with when it comes back
     otherwise   → the panel's own button, under the remaining count

   None of this is a security boundary. The Worker checks the session and the
   quota on every request; this only decides which button to draw. */
function AiGate({ children }) {
  const session = useSession();
  const { user, usage, loading, signIn } = session;

  if (loading) return null;

  if (!user) {
    return (
      <div className="mt-5">
        <button
          type="button"
          onClick={signIn}
          className="inline-flex items-center rounded-xl bg-ink px-4 py-2.5 text-[13px] font-semibold text-paper transition-opacity hover:opacity-90"
        >
          Sign in with GitHub to use AI
        </button>
        <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-faint">
          Only the AI review needs an account. The report, the preparation plan and the
          script export are free and need no sign-in.{" "}
          <Link to="/privacy" className="underline decoration-line-strong underline-offset-2 hover:text-ink">
            What is stored
          </Link>
        </p>
      </div>
    );
  }

  if (!hasQuota(session)) {
    return (
      <p className="mt-5 rounded-xl border border-line bg-paper px-4 py-3.5 text-[13px] leading-relaxed text-ink-soft">
        You have used all {usage.limit} free AI analyses this month. They come back on{" "}
        {usage.resets}. Everything else in this report still works.
      </p>
    );
  }

  return (
    <>
      {children}
      {usage && (
        <p className="mt-2.5 text-[12.5px] text-ink-faint">
          {usage.limit - usage.used} of {usage.limit} AI analyses left this month.
          {" "}Re-asking about the same file does not use another.
        </p>
      )}
    </>
  );
}

export default AiGate;
