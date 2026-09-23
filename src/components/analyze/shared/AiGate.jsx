import { Link } from "react-router-dom";

import { useSession, hasQuota } from "../../auth/sessionContext.js";

/* What stands between a review panel's explanation and its button.

   Three states, one place, so the target picker, the Quality tab and the Target
   Signal tab cannot drift into saying different things about the same account:

     signed out  → a sign-in button whose label names THIS panel's action, and
                   one line saying the rest of the report needs no account
     no quota    → the panel's button is withheld, with when it comes back
     otherwise   → the panel's own button, and nothing else

   Two deliberate absences:

   - No running count under the button. It used to print "N of 3 left" under
     every ask in all three panels, which made an account detail the loudest
     thing on a report about someone's data. The remaining count lives in the
     account menu, where a usage detail belongs.
   - No generic "use AI" wording. `ctaLabel` is written by the panel, so the
     button says what clicking it does ("Sign in to review columns"), not what
     technology answers it. The word AI stays where it is a disclosure — the
     badge, the line under each ask, /privacy — not in the calls to action.

   None of this is a security boundary. The Worker checks the session and the
   quota on every request; this only decides which button to draw. */
function AiGate({ ctaLabel, onAfterSignIn, children }) {
  const session = useSession();
  const { user, loading, signIn } = session;

  if (loading) return null;

  if (!user) {
    /* Sign in, then do the thing they actually asked for. Without this the
       click that opened the popup is forgotten and the user has to find the
       same button and press it a second time, which reads as the sign-in
       having failed. The popup never unloads this document, so the dataset,
       the report and this panel's state are all still here when it resolves. */
    const signInThenContinue = async () => {
      const result = await signIn();
      if (result?.ok) onAfterSignIn?.();
    };

    return (
      <div className="mt-5">
        <button
          type="button"
          onClick={signInThenContinue}
          className="inline-flex items-center rounded-xl bg-ink px-4 py-2.5 text-[13px] font-semibold text-paper transition-opacity hover:opacity-90"
        >
          {ctaLabel}
        </button>
        <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-faint">
          Only the deeper review needs an account. The report, the preparation plan and
          the script export do not.{" "}
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
        You have used today&apos;s deeper reviews. More become available tomorrow —
        everything else in this report still works.
      </p>
    );
  }

  return children;
}

export default AiGate;
