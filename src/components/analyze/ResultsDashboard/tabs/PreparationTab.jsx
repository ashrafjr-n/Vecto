import { useMemo, useState } from "react";
import { Check, CircleX, Copy, Download, TriangleAlert } from "lucide-react";

import SectionCard from "../../shared/SectionCard.jsx";
import StatTile    from "../../shared/StatTile.jsx";
import { buildPrepPlan } from "../../../../lib/prep/plan.js";
import { prepPlanToSklearn } from "../../../../lib/prep/sklearn.js";
import { MAX_CATEGORIES } from "../../../../lib/prep/encode.js";
import { SUSPICIOUS_SCORE, DIAG_FOLDS, DIAG_BINS } from "../../../../lib/prep/diagnostic.js";

const IMPUTE_TEXT = { mean: "mean", median: "median", most_frequent: "most frequent value" };

/* The split, in one sentence — the decision everything else depends on. */
function splitText(plan) {
  if (plan.groupBy) return `80 / 20, grouped by "${plan.groupBy}": every row of one value stays on one side, so an entity is never both learned and tested.`;
  if (plan.stratify) return "80 / 20, stratified: both sides keep the class shares.";
  if (plan.task === "classification") return "80 / 20, not stratified: a class has a single row, which cannot sit on both sides.";
  return "80 / 20, random.";
}

const METRIC = {
  balanced_accuracy: { name: "balanced accuracy", explain: "the mean of each class's recall, so guessing the majority class scores 1 ÷ classes however imbalanced the target is" },
  r2:                { name: "R²", explain: "the share of the target's variance the model explains, so predicting the training mean scores about 0" },
};
const COLUMNS_SHOWN = 10;
const fmt = (x) => x.toFixed(3);

/* One column alone, through the same model. Single series, value printed beside
   every bar (the bars are a reading aid, the numbers are the data), the baseline
   marked as a tick so "better than knowing nothing" is visible per row. */
function ColumnScores({ diagnostic }) {
  const { columns, baseline, metric } = diagnostic;
  const shown = columns.slice(0, COLUMNS_SHOWN);
  const pct = (x) => `${Math.round(Math.min(1, Math.max(0, x)) * 100)}%`;
  return (
    <div className="mt-5">
      <h4 className="text-[11px] font-medium text-ink-faint">
        Each column alone · {METRIC[metric].name}{columns.length > shown.length ? ` · best ${shown.length} of ${columns.length}` : ""}
      </h4>
      <ul className="mt-2 space-y-2">
        {shown.map(({ col, score }) => {
          const suspicious = score >= SUSPICIOUS_SCORE;
          return (
            <li key={col} className="flex items-center gap-3" title={`"${col}" alone: ${fmt(score)} ${METRIC[metric].name}, mean over ${diagnostic.folds} folds`}>
              <span className="w-40 shrink-0 truncate font-mono text-[12px] text-ink-soft">{col}</span>
              <div className="relative h-1.5 min-w-16 flex-1 rounded-full bg-paper">
                <div className="h-full rounded-full bg-ink-faint" style={{ width: pct(score) }} />
                <span className="absolute -top-1 h-3.5 w-px bg-ink-soft" style={{ left: pct(baseline.mean) }} />
              </div>
              <span className="w-12 shrink-0 text-right font-mono text-[12px] text-ink">{fmt(score)}</span>
              <span className="w-24 shrink-0">
                {suspicious && (
                  <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-critical">
                    <CircleX size={12} /> Check it
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[11.5px] text-ink-faint">The tick on each bar is the know-nothing baseline ({fmt(baseline.mean)}). Numbers are binned into {DIAG_BINS} quantile ranges here, so a curved relationship counts too.</p>
    </div>
  );
}

function DiagnosticCard({ diagnostic, target }) {
  if (!diagnostic) return null;
  if (diagnostic.status !== "ok") {
    return (
      <SectionCard title="Diagnostic baseline">
        <p className="text-[13px] text-ink-soft">No baseline was measured. {diagnostic.reason}</p>
      </SectionCard>
    );
  }
  const { model, baseline, metric, t, signal, suspicious, nearPerfect, unstable } = diagnostic;
  const tText = Number.isFinite(t) ? t.toFixed(1) : "∞";
  if (unstable) return <UnstableDiagnostic diagnostic={diagnostic} target={target} />;
  return (
    <SectionCard title="Diagnostic baseline">
      <p className="text-[13px] leading-relaxed text-ink-soft">
        One fixed, untuned model — ridge regression{diagnostic.task === "classification" ? " as a one-vs-rest classifier" : ""}, alpha 1 —
        trained on the plan below and cross-validated over {diagnostic.folds} folds ({diagnostic.split}), with the preparation re-fitted
        inside every fold. It is a measurement, not a model to use: the score is a floor for what these columns support.
        {" "}{diagnostic.sampled ? `Measured on an evenly spread sample of ${diagnostic.rows.toLocaleString()} rows.` : `${diagnostic.rows.toLocaleString()} rows.`}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Model" value={fmt(model.mean)} suffix={` ±${fmt(model.sd)}`} />
        <StatTile label="Knows nothing" value={fmt(baseline.mean)} />
        <StatTile label="Corrected t" value={tText} tone={signal ? "success" : "warning"} />
      </div>
      <p className="mt-4 text-[13px] leading-relaxed text-ink">
        {signal
          ? `The columns carry signal: the model beats the know-nothing baseline by ${fmt(model.mean - baseline.mean)} in ${METRIC[metric].name}, and the gap holds across the folds.`
          : `No reliable signal: the model does not beat the know-nothing baseline consistently across the folds.`}
      </p>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-faint">
        Score: {METRIC[metric].name}, {METRIC[metric].explain}. The verdict is a paired t-test across the {DIAG_FOLDS} folds with the
        Nadeau–Bengio correction for folds that share training rows; it needs t ≥ 2.78 (p &lt; 0.05).
        {!signal && " An untuned linear model can miss structure a flexible one would find — this says the easy signal is absent, not that none exists."}
      </p>

      {suspicious.length > 0 && (
        <div className="mt-4 flex items-start gap-3 rounded-lg border border-critical/20 bg-critical-tint px-4 py-3">
          <CircleX size={15} className="mt-0.5 shrink-0 text-critical" />
          <div className="text-[12.5px] text-ink-soft">
            <div className="font-semibold text-critical">
              {suspicious.length === 1 ? "One column" : `${suspicious.length} columns`} alone nearly decide{suspicious.length === 1 ? "s" : ""} the target
            </div>
            {suspicious.map(c => `"${c}"`).join(", ")} score{suspicious.length === 1 ? "s" : ""} {SUSPICIOUS_SCORE} or more by {suspicious.length === 1 ? "itself" : "themselves"} —
            the same bar the engine uses for leakage. That is how leakage looks: check that each is known before the outcome is.
          </div>
        </div>
      )}
      {nearPerfect && (
        <div className="mt-4 flex items-start gap-3 rounded-lg border border-warning/25 bg-warning-tint px-4 py-3">
          <TriangleAlert size={15} className="mt-0.5 shrink-0 text-warning" />
          <div className="text-[12.5px] text-ink-soft">
            <div className="font-semibold text-warning">Near-perfect for an untuned linear model</div>
            Either the target is genuinely easy to separate, or several columns together restate it. The ranking below shows which
            columns carry the score; confirm those are available before the outcome.
          </div>
        </div>
      )}
      <ColumnScores diagnostic={diagnostic} />
      <p className="mt-4 text-[11.5px] text-ink-faint">Columns the report already flags as leakage are left out of the plan, so they are not measured again here.</p>
    </SectionCard>
  );
}

/* R² from folds that disagree about the target's scale describes its extreme values, not
   the columns — so no score and no verdict are printed, only why (UNSTABLE_BASELINE). */
function UnstableDiagnostic({ diagnostic, target }) {
  return (
    <SectionCard title="Diagnostic baseline">
      <div className="flex items-start gap-3 rounded-lg border border-warning/25 bg-warning-tint px-4 py-3">
        <TriangleAlert size={15} className="mt-0.5 shrink-0 text-warning" />
        <div className="text-[12.5px] leading-relaxed text-ink-soft">
          <div className="font-semibold text-warning">R² is not meaningful for this target</div>
          Predicting the training average — which scores about 0 on an ordinary target — scored {fmt(diagnostic.worstBaseline)} in
          one of the {diagnostic.folds} folds. A few extreme values of "{target}" put the folds on different scales, so every
          R² here, the model&apos;s included, would describe those values rather than the columns. No signal verdict is given either way.
          Check the target&apos;s extreme values in the Statistics tab; once they are explained or removed, this can be measured.
        </div>
      </div>
    </SectionCard>
  );
}

function Group({ title, rows }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h4 className="text-[11px] font-medium text-ink-faint">{title} · {rows.length}</h4>
      <ul className="mt-2 divide-y divide-line">
        {rows.map(({ col, text }) => (
          <li key={col} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 first:pt-0 last:pb-0">
            <span className="font-mono text-[12px] text-ink">{col}</span>
            <span className="text-[12.5px] text-ink-soft">{text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlanCard({ plan }) {
  const withFlag = (text, flag) => (flag ? `${text}, plus a 1/0 column marking the rows that were missing` : text);
  const numeric = plan.numeric.map(f => ({ col: f.col, text: withFlag(`missing filled with the ${IMPUTE_TEXT[f.impute]}, then standardised`, f.flag) }));
  const categorical = plan.categorical.map(f => ({ col: f.col, text: withFlag(`one column per level (the ${MAX_CATEGORIES - 1} most frequent, the rest together); missing filled with the most frequent level`, f.flag) }));
  const presence = plan.presence.map(col => ({ col, text: "only whether a value was recorded (1/0) — more than half of it is missing" }));
  const excluded = plan.excluded.map(({ col, reason }) => ({ col, text: reason }));

  return (
    <SectionCard title="Preparation plan">
      <p className="text-[13px] leading-relaxed text-ink-soft">
        How a training pipeline treats each column, taken from the decisions in this report — the same
        imputation, indicators and exclusions the recommendations give. Target <span className="font-mono text-ink">{plan.target}</span>,
        {" "}{plan.task}. Rows with a missing target are dropped, never imputed{plan.dropDuplicates ? ", and duplicate rows are dropped before the split" : ""}.
      </p>
      <dl className="mt-4 rounded-xl border border-line bg-paper px-4 py-3 text-[12.5px]">
        <dt className="font-medium text-ink">Split first</dt>
        <dd className="mt-0.5 text-ink-soft">
          {splitText(plan)} Every median, mean, scale and category list is then learned from the training rows alone.
        </dd>
      </dl>
      <div className="mt-5 space-y-5">
        <Group title="Numeric" rows={numeric} />
        <Group title="Categorical" rows={categorical} />
        <Group title="Presence only" rows={presence} />
        <Group title="Left out" rows={excluded} />
      </div>
    </SectionCard>
  );
}

function ScriptCard({ plan, cleaningRules }) {
  const [copied, setCopied] = useState(false);
  const code = useMemo(() => prepPlanToSklearn(plan, cleaningRules), [plan, cleaningRules]);

  const download = () => {
    const url = URL.createObjectURL(new Blob([code], { type: "text/x-python" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "vecto_pipeline.py";
    link.click();
    URL.revokeObjectURL(url);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);   // clipboard refused (insecure context or denied) — the code stays selectable below
    }
  };

  return (
    <SectionCard title="scikit-learn pipeline">
      <p className="text-[13px] leading-relaxed text-ink-soft">
        The plan as a script: read, {cleaningRules.length > 0 ? `apply the ${cleaningRules.length} cleaning rule${cleaningRules.length > 1 ? "s" : ""} you accepted, ` : ""}split,
        then fit the preparation on the training rows and apply it to both sides. It prepares features and stops
        there — no model, no tuning. Needs pandas and scikit-learn 1.2 or newer.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={download}
          className="inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-[12.5px] font-semibold text-paper-sunken transition-opacity hover:opacity-90"
        >
          <Download size={14} /> Download vecto_pipeline.py
        </button>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-2 rounded-xl border border-line px-4 py-2.5 text-[12.5px] font-medium text-ink-soft transition-colors hover:border-ink-faint hover:text-ink"
        >
          {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
        </button>
      </div>
      <details className="mt-4 text-[12.5px] text-ink-soft">
        <summary className="cursor-pointer font-medium hover:text-ink">Show the script</summary>
        <pre className="mt-2 max-h-96 overflow-auto rounded-lg border border-line bg-paper p-3 font-mono text-[11px] leading-relaxed text-ink-soft">{code}</pre>
      </details>
    </SectionCard>
  );
}

function PreparationTab({ result, ai }) {
  const plan = useMemo(() => buildPrepPlan(result), [result]);
  const cleaningRules = ai?.cleaningRules ?? [];

  if (!plan.usable) {
    return (
      <SectionCard title="Preparation plan">
        <p className="text-[13px] text-ink-soft">{plan.reason}</p>
      </SectionCard>
    );
  }
  return (
    <div className="space-y-5">
      <DiagnosticCard diagnostic={result.diagnostic} target={result.meta.target} />
      <PlanCard plan={plan} />
      <ScriptCard plan={plan} cleaningRules={cleaningRules} />
    </div>
  );
}

export default PreparationTab;
