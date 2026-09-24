import { Clock } from "lucide-react";

/* A limit is not a failure: no warning colour, no "something went wrong". It says
   what is used up, that the report itself is never limited, and when reviews come
   back. Drawn by AiGate before an ask and by AiPanel when the Worker refuses one,
   so both say the same thing. */

const COPY = {
  quota_exhausted: {
    title: "Today's deeper reviews are used up",
    lead: "",
  },
  monthly_ceiling: {
    title: "This month's deeper reviews are used up",
    lead: "",
  },
  budget_exhausted: {
    title: "Deeper reviews are paused for today",
    lead: "Vecto's shared allowance for today has run out — this is not your account's limit. ",
  },
};

/* The Worker's periods are UTC (periodOf / monthStart in worker/usage.js), so the
   reset is a UTC midnight, shown in the reader's own time. */
function backAt(code) {
  const now = new Date();
  if (code === "monthly_ceiling") {
    const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return `on ${at.toLocaleDateString(undefined, { month: "long", day: "numeric" })}`;
  }
  const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const day = at.toDateString() === now.toDateString()
    ? "today"
    : at.toLocaleDateString(undefined, { weekday: "long" });
  return `${day} at ${at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

function LimitNotice({ code }) {
  const { title, lead } = COPY[code] ?? COPY.quota_exhausted;
  return (
    <div className="mt-5 rounded-xl border border-line bg-paper px-4 py-3.5">
      <p className="flex items-center gap-2 text-[13px] font-semibold text-ink">
        <Clock size={14} className="shrink-0 text-ink-faint" />
        {title}
      </p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">
        {lead}Your report has no limit: every section, the preparation plan and the script
        export keep working. Deeper reviews are back {backAt(code)}.
      </p>
    </div>
  );
}

export default LimitNotice;
