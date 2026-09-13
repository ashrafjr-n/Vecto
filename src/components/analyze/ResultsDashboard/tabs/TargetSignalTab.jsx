import { motion } from "framer-motion";

import SectionCard from "../../shared/SectionCard.jsx";
import StatusBadge from "../../shared/StatusBadge.jsx";
import { correlationFill } from "../../shared/correlationColor.js";
import AiLeakageReview from "./AiLeakageReview.jsx";

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
    title: "Numeric against categorical",
    sub:   "Rank-based η (Kruskal–Wallis, bias-corrected) — how strongly the categories separate the numeric side's ranks: a numeric feature across the target's classes, or a numeric target across a categorical feature's levels. Ranks keep one extreme value from deciding it.",
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

/* Below this share of the dataset the coefficient describes a slice, not the
   file. openpowerlifting.csv's top row is a fourth-attempt column measured on
   1,225 of 386,414 rows — the n was already printed, but next to five rows that
   cover everything it does not read as the qualification it is. */
const COVERAGE_MIN = 0.5;

function SignalRow({ col, entry, index, rows }) {
  const abs  = Math.min(1, Math.abs(entry.absValue ?? 0));
  const sig  = significanceOf(entry);
  /* The bar is a magnitude, so an unsigned metric must not borrow the diverging
     scale's negative arm — Cramér's V and η have no sign to encode. */
  const fill = entry.metric === "pearson" ? correlationFill(entry.value) : correlationFill(abs);

  const divergence = entry.spearman != null
    && Math.abs(entry.spearman) - Math.abs(entry.value) > 0.1;

  const coverage = rows > 0 ? (entry.n ?? 0) / rows : 1;
  const narrow   = coverage < COVERAGE_MIN;

  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink">{col}</span>
        <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-paper">
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
          <span className="rounded bg-accent-tint px-1.5 py-0.5 text-[11px] text-accent-ink">
            Spearman {entry.spearman.toFixed(2)} — monotonic, not linear
          </span>
        )}

        {narrow && (
          <span className="rounded bg-warning-tint px-1.5 py-0.5 text-[11px] text-warning">
            measured on {(coverage * 100).toFixed(1)}% of rows — a slice, not the dataset
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

/* ── Missingness as a feature ───────────────────────────────────────────────
   Whether a column was RECORDED is a second variable, separate from its values,
   and it is often the one carrying the signal. This sits above the metric groups
   because on a dataset where it fires it is usually the strongest thing in the
   report: on smoking.csv three columns score V = 1.00 here while the best value-
   based association in the groups below is 0.22. */
function PresenceSignals({ signals, target }) {
  if (!signals.length) return null;
  return (
    <SectionCard
      title="Missingness carries signal"
      action={<StatusBadge severity="warning">{signals.length} column{signals.length > 1 ? "s" : ""}</StatusBadge>}
    >
      <p className="-mt-2 mb-3 text-[12px] leading-relaxed text-ink-faint">
        Cramér's V between a <span className="font-mono">present / absent</span> indicator and{" "}
        <span className="font-mono text-ink-soft">{target}</span> — measured on the column&apos;s
        missingness, not on its values. A high score means the rows where the value is
        recorded are not a random sample.
      </p>
      <div className="divide-y divide-line">
        {signals.map((p) => (
          <div key={p.col} className="py-3 first:pt-0 last:pb-0">
            <div className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink">
                {p.col}_present
              </span>
              <span className="shrink-0 font-mono text-[11.5px] text-ink-faint">
                present in {p.presentPct}% of rows
              </span>
              <span className="w-14 shrink-0 text-right font-mono text-[12px] font-semibold text-ink">
                {p.cramersV.toFixed(2)}
              </span>
            </div>
            <div className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">
              {/* A perfect separator is as likely to be the label restated as it is
                  to be a finding — say so rather than presenting it as a win. */}
              {p.cramersV >= 0.95
                ? `Separates ${target} almost perfectly over ${p.n} rows — check this is not the label itself, recorded twice.`
                : `Measured over ${p.n} rows. Build "${p.col}_present" and keep it even if the column's values are dropped.`}
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function MetricGroup({ group, entries, rows }) {
  if (!entries.length) return null;
  return (
    <SectionCard
      title={group.title}
      action={<span className="font-mono text-[11px] text-ink-faint">{group.range}</span>}
    >
      <p className="-mt-2 mb-3 text-[12px] leading-relaxed text-ink-faint">{group.sub}</p>
      <div className="divide-y divide-line">
        {entries.map(([col, entry], i) => (
          <SignalRow key={col} col={col} entry={entry} index={i} rows={rows} />
        ))}
      </div>
    </SectionCard>
  );
}

/* ── What was NOT measured ──────────────────────────────────────────────────
   Every column here used to be absent from this tab entirely: no row, no note,
   nothing. A reader had no way to tell "scored low" from "never scored", so the
   tab's own summary line ("the strongest association is 0.22") read as a verdict
   on the whole dataset when it was a verdict on part of it. */
function UnscoredColumns({ columns, target }) {
  if (!columns.length) return null;
  return (
    <SectionCard
      title="Not measured against the target"
      action={<StatusBadge severity="info">{columns.length} column{columns.length > 1 ? "s" : ""}</StatusBadge>}
    >
      <p className="-mt-2 mb-3 text-[12px] leading-relaxed text-ink-faint">
        These were left out of the scan above. Not measured is not the same as no
        signal — the reason each one could not be compared to{" "}
        <span className="font-mono text-ink-soft">{target}</span> is given below.
      </p>
      <div className="divide-y divide-line">
        {columns.map((u) => (
          <div key={u.col} className="py-2.5 first:pt-0 last:pb-0">
            <div className="font-mono text-[12.5px] text-ink">{u.col}</div>
            <div className="mt-0.5 text-[12px] leading-relaxed text-ink-soft">{u.reason}</div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

/* `ai` = { data, dossier, leakageReview, onLeakageReview }, owned by Analyze.jsx. */
function TargetSignalTab({ result, ai }) {
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

  const presence = relationships.presenceSignals ?? [];
  const unscored = relationships.unscoredColumns ?? [];

  /* Only a genuinely empty tab short-circuits. The old check returned here on an
     empty targetCorrelations alone, which would now hide the presence signals and
     the unscored list — the two things that explain WHY it is empty. */
  if (!entries.length && !presence.length && !unscored.length) {
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

  /* A presence indicator is measured with Cramér's V, the same scale as the
     categorical group, so it belongs in the same comparison — and on smoking.csv
     it beats every value-based association 1.00 to 0.22. Announcing 0.22 as "the
     strongest" while a stronger measured association sits in the card above is
     the contradiction this tab existed to remove. */
  const topPresence = presence[0] ?? null;
  const presenceLeads = topPresence && topPresence.cramersV > (strongest?.[1]?.absValue ?? 0);

  /* An unusable target is the finding, not "no signal": the scan did not fail to
     find an association, there was nothing to associate with. Found in the
     browser — a single-valued target read "unlikely to beat the base rate" beside
     a recommendation to pick a different target. */
  const targetProblem = meta.targetIsConstant
    ? { badge: "Target never varies", text: "has the same value on every row, so no column can be associated with it. Pick a different target and re-run." }
    : meta.targetIsIdentifier
      ? { badge: "Target is an identifier", text: "is unique per row — an identifier, not a label — so any association with it would be memorisation. Pick a different target and re-run." }
      : null;

  return (
    <div className="space-y-4">
      <SectionCard
        title="Target signal"
        action={
          /* Presence counts as signal. Without it the badge could read "No
             detectable signal" directly above a presence indicator scoring 1.00. */
          targetProblem
            ? <StatusBadge severity="critical">{targetProblem.badge}</StatusBadge>
            : anySignificant || presence.length > 0
              ? <StatusBadge severity="success">Signal found</StatusBadge>
              : <StatusBadge severity="warning">No detectable signal</StatusBadge>
        }
      >
        <p className="text-[12.5px] leading-relaxed text-ink-soft">
          {targetProblem ? (
            <>
              <span className="font-mono text-ink">{meta.target}</span> {targetProblem.text}
            </>
          ) : presenceLeads ? (
            <>
              The strongest association with{" "}
              <span className="font-mono text-ink">{meta.target}</span> is not a column&apos;s
              values but its <em>missingness</em>:{" "}
              <span className="font-mono text-ink">{topPresence.col}_present</span> at{" "}
              <span className="font-mono text-ink">{topPresence.cramersV.toFixed(2)}</span>
              {strongest && (
                <>
                  , against{" "}
                  {/* Magnitude, not the signed value: this sentence compares 1.00 to
                      0.22, and printing "-0.22" beside it invites the reading that one
                      is below the other on a shared signed scale. */}
                  <span className="font-mono text-ink">{(strongest[1].absValue ?? 0).toFixed(2)}</span> for the
                  best value-based feature (<span className="font-mono text-ink">{strongest[0]}</span>)
                </>
              )}.
            </>
          ) : anySignificant ? (
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
          {entries.length > 0 && (
            <>
              Each metric below is grouped on its own because they are not directly comparable —
              they measure different kinds of association and are estimated differently.
            </>
          )}
          {unscored.length > 0 && (
            <>
              {" "}
              <span className="text-ink-faint">
                {unscored.length} column{unscored.length > 1 ? "s were" : " was"} not measured at all —
                listed at the bottom with the reason.
              </span>
            </>
          )}
        </p>
      </SectionCard>

      {/* An unusable target has no timing to reason about, and no rows means nothing to measure a claim on. */}
      {!targetProblem && ai?.data && (
        <AiLeakageReview
          result={result}
          data={ai.data}
          dossier={ai.dossier}
          review={ai.leakageReview}
          onReview={ai.onLeakageReview}
        />
      )}

      <PresenceSignals signals={relationships.presenceSignals ?? []} target={meta.target} />

      {METRIC_GROUPS.map((g) => (
        <MetricGroup key={g.key} group={g} rows={meta.rows} entries={sorted.filter(([, e]) => e.metric === g.key)} />
      ))}

      <UnscoredColumns columns={relationships.unscoredColumns ?? []} target={meta.target} />
    </div>
  );
}

export default TargetSignalTab;
