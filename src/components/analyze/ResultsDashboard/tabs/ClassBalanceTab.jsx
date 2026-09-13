import { motion } from "framer-motion";
import { TriangleAlert } from "lucide-react";

import SectionCard from "../../shared/SectionCard.jsx";
import StatusBadge  from "../../shared/StatusBadge.jsx";

/* A real classification target has a handful of classes. Anything past this is
   a symptom (an id picked as the target), not something to render in full. */
const MAX_CLASS_ROWS = 15;

function ClassBalanceTab({ result }) {
  const { classBalance, meta } = result;

  if (!classBalance || !classBalance.classes.length) {
    return (
      <SectionCard>
        <div className="py-8 text-center text-[13px] text-ink-faint">No target column selected or no class data available.</div>
      </SectionCard>
    );
  }

  const { classes, isImbalanced } = classBalance;

  /* reduce(), not Math.max(...classes.map(...)): the spread passes one call
     argument per class and throws RangeError past ~125k of them. `classes` is
     unbounded — it is one entry per distinct target value, and nothing stops a
     user picking a near-unique column (an id, a name, a ticket number) as the
     target. */
  const maxPct = classes.reduce((m, c) => (c.pct > m ? c.pct : m), 0);

  /* Same reason, for the DOM: rendering one animated bar per class melts the
     page on a high-cardinality target. `classes` arrives sorted by count, so
     the head is the informative part; the rest is summarised in one line. */
  const shown  = classes.slice(0, MAX_CLASS_ROWS);
  const hidden = classes.length - shown.length;

  return (
    <div className="space-y-4">
      <SectionCard
        title="Target column"
        action={<StatusBadge severity={isImbalanced ? "warning" : "success"}>{isImbalanced ? "Imbalanced" : "Balanced"}</StatusBadge>}
      >
        <div className="mb-5 font-mono text-lg font-semibold text-ink">{meta.target}</div>

        <div className="space-y-4">
          {shown.map((cls, i) => {
            const isMax = cls.pct === maxPct;
            return (
              <div key={i}>
                <div className="mb-1.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-ink">{String(cls.value)}</span>
                    {isMax && <span className="rounded bg-paper px-1.5 py-0.5 text-[9px] font-medium text-ink-faint">majority</span>}
                    {cls.missing && <span className="rounded bg-warning-tint px-1.5 py-0.5 text-[9px] font-medium text-warning">missing</span>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[11.5px] text-ink-faint">{cls.count.toLocaleString()} rows</span>
                    <span className={`w-11 text-right font-mono text-[13px] font-semibold ${isMax ? "text-accent-ink" : "text-ink-soft"}`}>{cls.pct}%</span>
                  </div>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-paper">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${cls.pct}%` }}
                    transition={{ delay: Math.min(i * 0.05, 0.6), duration: 0.5, ease: "easeOut" }}
                    className={`h-full rounded-full ${isMax ? "bg-accent" : "bg-ink-faint/60"}`}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {hidden > 0 && (
          <div className="mt-4 border-t border-line pt-3 text-[12.5px] text-ink-faint">
            Showing the {MAX_CLASS_ROWS} largest of {classes.length.toLocaleString()} distinct
            values. A target with this many classes is usually an identifier rather than a
            label — check the target column.
          </div>
        )}
      </SectionCard>

      {isImbalanced && (
        <div className="flex items-start gap-3 rounded-lg border border-warning/20 bg-warning-tint px-4 py-3.5">
          <TriangleAlert size={16} className="mt-0.5 shrink-0 text-warning" />
          <div>
            <div className="text-[13px] font-semibold text-warning">Uneven class distribution detected</div>
            <div className="mt-0.5 text-[12.5px] leading-relaxed text-ink-soft">
              The majority class represents {maxPct}% of the data. Consider oversampling the
              minority class (e.g. SMOTE) or using class-weighted models to avoid biased predictions.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ClassBalanceTab;
