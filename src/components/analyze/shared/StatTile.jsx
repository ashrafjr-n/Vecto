/* Stat-tile contract per the dataviz skill: label (sentence case, no colon) +
   value (mono, this system's numeric signal — see frontend.md typography) + an
   optional suffix. No delta/sparkline — the engine has no historical data to
   compare against, so one is never faked. */
function StatTile({ label, value, suffix, tone = "ink" }) {
  const toneCls = {
    ink:      "text-ink",
    success:  "text-success",
    warning:  "text-warning",
    critical: "text-critical",
  }[tone] ?? "text-ink";

  return (
    <div className="rounded-[1.25rem] border border-line bg-paper-sunken px-5 py-4">
      <div className="text-[12px] text-ink-faint">{label}</div>
      <div className={`mt-2 font-mono text-2xl font-medium tracking-tight ${toneCls}`}>
        {value}
        {suffix && <span className="ml-0.5 text-sm font-normal text-ink-faint">{suffix}</span>}
      </div>
    </div>
  );
}

export default StatTile;
