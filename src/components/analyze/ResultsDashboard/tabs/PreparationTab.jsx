import { useMemo, useState } from "react";
import { Check, Copy, Download } from "lucide-react";

import SectionCard from "../../shared/SectionCard.jsx";
import { buildPrepPlan } from "../../../../lib/prep/plan.js";
import { prepPlanToSklearn } from "../../../../lib/prep/sklearn.js";
import { MAX_CATEGORIES } from "../../../../lib/prep/encode.js";

const IMPUTE_TEXT = { mean: "mean", median: "median", most_frequent: "most frequent value" };

/* The split, in one sentence — the decision everything else depends on. */
function splitText(plan) {
  if (plan.groupBy) return `80 / 20, grouped by "${plan.groupBy}": every row of one value stays on one side, so an entity is never both learned and tested.`;
  if (plan.stratify) return "80 / 20, stratified: both sides keep the class shares.";
  if (plan.task === "classification") return "80 / 20, not stratified: a class has a single row, which cannot sit on both sides.";
  return "80 / 20, random.";
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
      <PlanCard plan={plan} />
      <ScriptCard plan={plan} cleaningRules={cleaningRules} />
    </div>
  );
}

export default PreparationTab;
