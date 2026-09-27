import { CalendarClock, CircleCheckBig, TriangleAlert } from "lucide-react";
import { motion } from "framer-motion";

import SectionCard from "../../shared/SectionCard.jsx";

/* The date column and what it says about splitting (lib/timeChecks.js). Drawn only
   when the file has a date column the checks could read. */

const day = (t) => new Date(t).toISOString().slice(0, 10);
const fmtP = (p) => (p === null ? "—" : p < 0.001 ? "< 0.001" : p.toFixed(3));

function TargetOverTime({ time, target }) {
  const t = time.target;
  if (!t) return null;
  const values = time.periods.map((p) => p.value ?? 0);
  const max = Math.max(...values, t.kind === "rate" ? 0.0001 : Number.EPSILON);
  const show = (v) => (v === null ? "—" : t.kind === "rate" ? `${(v * 100).toFixed(1)}%` : Number(v.toPrecision(4)).toLocaleString());

  return (
    <SectionCard title={t.kind === "rate" ? `Share of "${t.label}" over time` : `Average "${target}" over time`}>
      <p className="-mt-1 mb-4 text-[12.5px] leading-relaxed text-ink-soft">
        The rows ordered by <span className="font-mono">{time.column}</span> and cut into {time.periods.length} periods
        of equal size.{" "}
        {t.drifts
          ? <span className="text-warning">It changes over time — beyond chance (p {fmtP(t.pValue)}) and by enough to matter.</span>
          : <span>No change that is both beyond chance and large enough to matter (p {fmtP(t.pValue)}).</span>}
      </p>
      <div className="space-y-2.5">
        {time.periods.map((p, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="w-44 shrink-0 font-mono text-[11.5px] text-ink-soft">{day(p.from)} – {day(p.to)}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-paper">
              <motion.div
                className="h-full rounded-full"
                style={{ background: t.drifts ? "var(--color-warning)" : "var(--color-info)" }}
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(2, ((p.value ?? 0) / max) * 100)}%` }}
                transition={{ duration: 0.5, ease: "easeOut" }}
              />
            </div>
            <span className="w-16 shrink-0 text-right font-mono text-[12px] text-ink">{show(p.value)}</span>
            <span className="hidden w-16 shrink-0 text-right font-mono text-[11px] text-ink-faint sm:inline">{p.rows.toLocaleString()} rows</span>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function TimeTab({ result }) {
  const time = result.time;
  if (!time) return null;
  const { meta } = result;

  return (
    <div className="space-y-4">
      <SectionCard title="Dates">
        <div className="flex items-start gap-3">
          <CalendarClock size={16} className="mt-0.5 shrink-0 text-ink-faint" />
          <div className="text-[13px] leading-relaxed text-ink-soft">
            <span className="font-mono text-ink">{time.column}</span> runs from{" "}
            <span className="font-mono text-ink">{day(time.from)}</span> to <span className="font-mono text-ink">{day(time.to)}</span>
            {" "}— {time.parsed.toLocaleString()} dated rows{time.unparsed > 0 ? `, ${time.unparsed.toLocaleString()} empty or unreadable` : ""}.
            {time.dayFirstAssumed && " Dates like 03/04 could be read either way and nothing in the file settles it; they are read month-first."}
            {time.others.length > 0 && <> Other date columns: {time.others.map((c) => <span key={c} className="font-mono"> {c}</span>)} — this one has the most readable dates.</>}
          </div>
        </div>
      </SectionCard>

      <TargetOverTime time={time} target={meta.target} />

      <SectionCard title="How to split">
        {time.recommendTimeSplit ? (
          <div className="flex items-start gap-3">
            <TriangleAlert size={15} className="mt-0.5 shrink-0 text-warning" />
            <div className="space-y-2 text-[13px] leading-relaxed text-ink-soft">
              <p>
                If <span className="font-mono text-ink">{time.column}</span> is when each row was recorded, a random split is
                optimistic: it tests the model on the same period it learned from. Train on rows before{" "}
                <span className="font-mono text-ink">{day(time.cutoff)}</span> (the first 80%) and test on the rest.
              </p>
              <p>
                If it describes the entity instead — a hire date, a birth date, an account opening — it is a feature, not
                the time of the row: derive tenure or age from it, and a random split is fine.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3">
            <CircleCheckBig size={15} className="mt-0.5 shrink-0 text-success" />
            <p className="text-[13px] leading-relaxed text-ink-soft">
              Nothing here moves with <span className="font-mono text-ink">{time.column}</span>, so a random split is not
              misleading by itself. If the model will predict rows from after this file, a time split
              (before <span className="font-mono text-ink">{day(time.cutoff)}</span> to train) is still the more honest test.
            </p>
          </div>
        )}
      </SectionCard>

      {time.lateColumns.length > 0 && (
        <SectionCard title="Columns that start part-way">
          <div className="divide-y divide-line">
            {time.lateColumns.map((c) => (
              <div key={c.col} className="flex items-start justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
                <div>
                  <div className="font-mono text-[12.5px] text-ink">{c.col}</div>
                  <div className="text-[12px] text-ink-soft">
                    {c.earlyMissingPct}% empty in the earliest fifth of the rows, {c.lateMissingPct}% in the latest
                    {c.startsAt ? ` — first recorded ${day(c.startsAt)}` : ""}. Whether it is filled in says when the row is from.
                  </div>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {time.futureRows > 0 && (
        <SectionCard title="Dates in the future">
          <p className="text-[13px] leading-relaxed text-ink-soft">
            {time.futureRows.toLocaleString()} row{time.futureRows === 1 ? " is" : "s are"} dated after today. Check whether
            they are typos, placeholders or planned dates before treating them as history.
          </p>
        </SectionCard>
      )}
    </div>
  );
}

export default TimeTab;
