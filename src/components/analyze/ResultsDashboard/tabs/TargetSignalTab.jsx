import { motion } from "framer-motion";

import SectionCard from "../../shared/SectionCard.jsx";
import StatusBadge from "../../shared/StatusBadge.jsx";
import { correlationFill } from "../../shared/correlationColor.js";

/* ─────────────────────────────────────────────
   TARGET SIGNAL — which columns actually relate to the target.

   The engine has always computed `targetCorrelations` across EVERY column type
   with a metric appropriate to each, and rendered it nowhere. It was finding #8
   of the original audit and the most valuable output in the product.

   Metrics are shown in SEPARATE GROUPS, never one merged ranking. Pearson,
   Cramér's V and η all land on a 0–1 magnitude, which makes them look
   comparable, and they are not: -0.54 for a binary feature and 0.17 for a
   categorical one answer different questions and are estimated differently.
   Sorting them into a single league table would imply an ordering the numbers
   do not support.
───────────────────────────────────────────── */

const METRIC_GROUPS = [
  {
    key:   "pearson",
    title: "Numeric and binary features",
    sub:   "Pearson r — linear association, signed. For a binary feature this is the point-biserial correlation.",
    range: "−1 to +1",
  },
  {
    key:   "cramers_v",
    title: "Categorical features",
    sub:   "Cramér's V with the Bergsma bias correction, so a column with one distinct value per row scores 0 rather than climbing on cardinality alone.",
    range: "0 to 1",
  },
  {
    key:   "eta",
    title: "Numeric features against a categorical target",
    sub:   "Correlation ratio η — how much of the feature's variance the target's classes explain.",
    range: "0 to 1",
  },
];

/* Plain language first, the number second, and the sample size always beside it.
   A bare "p = 0.03" reads as "important" to anyone who is not a statistician,
   and a p-value without n is not interpretable. */
function significanceOf(entry) {
  const { pValue, n } = entry;
  if (pValue == null) return { text: "not testable at this sample size", strong: false };
  const shown = pValue < 0.001 ? "p < 0.001" : `p = ${pValue.toFixed(pValue < 0.01 ? 4 : 3)}`;
  return pValue < 0.05
    ? { text: `distinguishable from chance (${shown}, n = ${n})`, strong: true }
    : { text: `not distinguishable from chance (${shown}, n = ${n})`, strong: false };
}

function SignalRow({ col, entry, index }) {
  const abs  = Math.min(1, Math.abs(entry.absValue ?? 0));
  const sig  = significanceOf(entry);
  /* The bar is a magnitude, so an unsigned metric must not borrow the diverging
     scale's negative arm — Cramér's V and η have no sign to encode. */
  const fill = entry.metric === "pearson" ? correlationFill(entry.value) : correlationFill(abs);

  const divergence = entry.spearman != null
    && Math.abs(entry.spearman) - Math.abs(entry.value) > 0.1;

  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink">{col}</span>
        <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-paper-sunken">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${Math.round(abs * 100)}%` }}
            transition={{ delay: Math.min(index * 0.04, 0.5), duration: 0.4, ease: "easeOut" }}
            className="h-full rounded-full"
            style={{ background: fill }}
          />
        </div>
        <span className="w-14 shrink-0 text-right font-mono text-[12px] font-semibold text-ink">
          {entry.value.toFixed(2)}
        </span>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-0 text-[11.5px] text-ink-faint">
        <span className={sig.strong ? "text-ink-soft" : ""}>{sig.text}</span>

        {divergence && (
          <span className="rounded bg-gold-tint px-1.5 py-0.5 text-[11px] text-gold-ink">
            Spearman {entry.spearman.toFixed(2)} — monotonic, not linear
          </span>
        )}

        {entry.mi != null && entry.mi >= 0.15 && (
          <span className="rounded bg-info-tint px-1.5 py-0.5 text-[11px] text-info">
            mutual information {entry.mi.toFixed(2)} — carries signal the correlation misses
          </span>
        )}
      </div>
    </div>
  );
}

function MetricGroup({ group, entries }) {
  if (!entries.length) return null;
  return (
    <SectionCard
      title={group.title}
      action={<span className="font-mono text-[11px] text-ink-faint">{group.range}</span>}
    >
      <p className="-mt-2 mb-3 text-[12px] leading-relaxed text-ink-faint">{group.sub}</p>
      <div className="divide-y divide-line">
        {entries.map(([col, entry], i) => (
          <SignalRow key={col} col={col} entry={entry} index={i} />
        ))}
      </div>
    </SectionCard>
  );
}

function TargetSignalTab({ result }) {
  const { meta, relationships } = result;
  const entries = Object.entries(relationships.targetCorrelations ?? {});

  if (!meta.target) {
    return (
      <SectionCard>
        <div className="py-8 text-center text-[13px] text-ink-faint">
          No target column selected — there is nothing to relate the features to.
        </div>
      </SectionCard>
    );
  }

  if (!entries.length) {
    return (
      <SectionCard>
        <div className="py-8 text-center text-[13px] text-ink-faint">
          No feature could be tested against <span className="font-mono text-ink-soft">{meta.target}</span>.
        </div>
      </SectionCard>
    );
  }

  const sorted = [...entries].sort((a, b) => (b[1].absValue ?? 0) - (a[1].absValue ?? 0));
  const strongest = sorted[0];
  const anySignificant = sorted.some(([, e]) => e.pValue != null && e.pValue < 0.05);

  return (
    <div className="space-y-4">
      <SectionCard
        title="Target signal"
        action={
          anySignificant
            ? <StatusBadge severity="success">Signal found</StatusBadge>
            : <StatusBadge severity="warning">No detectable signal</StatusBadge>
        }
      >
        <p className="text-[12.5px] leading-relaxed text-ink-soft">
          {anySignificant ? (
            <>
              The strongest association with{" "}
              <span className="font-mono text-ink">{meta.target}</span> is{" "}
              <span className="font-mono text-ink">{strongest[0]}</span> at{" "}
              <span className="font-mono text-ink">{strongest[1].value.toFixed(2)}</span>.
            </>
          ) : (
            <>
              No feature reaches statistical significance against{" "}
              <span className="font-mono text-ink">{meta.target}</span>. A model trained on
              these columns as they stand is unlikely to beat the base rate.
            </>
          )}{" "}
          Each metric below is grouped on its own because they are not directly comparable —
          they measure different kinds of association and are estimated differently.
        </p>
      </SectionCard>

      {METRIC_GROUPS.map((g) => (
        <MetricGroup key={g.key} group={g} entries={sorted.filter(([, e]) => e.metric === g.key)} />
      ))}
    </div>
  );
}

export default TargetSignalTab;
