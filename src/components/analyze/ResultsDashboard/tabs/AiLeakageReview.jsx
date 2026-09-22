import { Link } from "react-router-dom";
import { RotateCcw } from "lucide-react";

import { buildLeakagePayload } from "../../../../lib/ai/leakage.js";
import AiPanel          from "../../shared/AiPanel.jsx";
import AiPayloadPreview from "../../shared/AiPayloadPreview.jsx";
import StatusBadge      from "../../shared/StatusBadge.jsx";
import { RELEVANCE_CATEGORIES } from "../../../../lib/ai/leakageSchema.js";

/* AI phase C: which columns a model could not use at prediction time. The engine
   already flags near-deterministic associations; what it cannot see is TIMING and
   MEANING — a total that includes the target, a status recorded afterwards, a
   customer who appears on both sides of a split.

   Every checkable claim arrives with a measurement made on the rows here (see
   verifyLeakage). The review is advisory: it changes no flag, score or piece of
   advice.

   This component only renders. The request, its answer, its status and its abort
   all live in Analyze.jsx, because C starts by itself once the report is built and
   this panel does not exist until the Target Signal tab is opened — by which time
   the answer is often already here. Switching tabs spends nothing either way. */

const CATEGORY_LABEL = {
  derived_from_target:    "Derived from the target",
  recorded_after_outcome: "Recorded after the outcome",
  restates_label:         "Restates the label",
  group_leak:             "Entity repeats across rows",
  /* Relevance (item 31): worth keeping / worth doubting. Neither is an accusation,
     and the labels say which way each one points so the row cannot be skimmed as one. */
  plausible_despite_weak_signal: "Weak number, but it should matter",
  implausible_despite_signal:    "Strong number, but no reason to matter",
};

/* Verdict is about the CLAIM: "confirmed" means the data bears the leak out,
   which is the worst news, so it takes the critical colour. */
const VERDICT = {
  confirmed:    { severity: "critical", label: "Data confirms it" },
  partial:      { severity: "warning",  label: "Partly supported" },
  question:     { severity: "info",     label: "Question for you" },
  unchecked:    { severity: "info",     label: "For you to judge" },
  contradicted: { severity: "success",  label: "Data disagrees" },
};
const VERDICT_ORDER = ["confirmed", "partial", "contradicted", "question", "unchecked"];

/* A claim the engine could MEASURE against the rows, versus one that rests on what the
   model thinks a column means. Only the first kind is reported as a concern.

   Every false accusation in the day-2 eval was the second kind — a `derived_from_target`
   with no formula to evaluate (diamonds x/y/z "derived from price" are a diamond's physical
   dimensions; ai_student `Pre_Semester_GPA` precedes the target it was said to come from).
   Rendered beside a measured leak they read as verdicts, and an unfalsifiable claim stated
   as a verdict costs the user a good feature. They are questions, and they are asked as
   questions. */
const MEASURED = ["confirmed", "partial", "contradicted"];

const SPLIT_LABEL = {
  random:       "A random split is appropriate",
  grouped:      "Split by group, on",
  time_ordered: "Split by time, on",
};

function AiLeakageReview({ result, dossier, review, status, failure, onAsk, onCancel }) {
  const payload = () => buildLeakagePayload(result, dossier);

  return (
    <AiPanel
      title="Leakage review"
      status={status}
      failure={failure}
      onCancel={onCancel}
      loadingText="Reviewing for leakage — usually under a minute. Nothing else waits for it."
    >
      {!review && (
        <>
          <p className="mt-4 text-[13.5px] leading-relaxed text-ink-soft">
            Looks for columns that would not exist when a real prediction is made: computed
            from the target, recorded after the outcome, or repeating one entity across rows.
            Formulas and group claims are measured on your rows before they are shown.
          </p>
          <AiPayloadPreview
            build={payload}
            sent={<>Sends column names, roles and the engine&apos;s measurements{dossier ? ", plus the column meanings from the review" : ""}, never cell values, to OpenRouter&apos;s free models, which may log requests. <Link to="/privacy" className="underline decoration-line-strong underline-offset-2 hover:text-ink">Privacy</Link></>}
          />
          <button
            type="button"
            onClick={onAsk}
            className="mt-5 inline-flex items-center rounded-xl border border-line-strong px-4 py-2.5 text-[13px] font-semibold text-ink transition-colors hover:bg-accent-tint"
          >
            {status === "error" ? "Try again" : "Review for leakage"}
          </button>
        </>
      )}

      {review && <ReviewResult review={review} target={result.meta.target} onAskAgain={onAsk} />}
    </AiPanel>
  );
}

function FindingRow({ f }) {
  return (
    <li className="px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[13px] text-ink">{f.column}</span>
        <span className="text-[11.5px] text-ink-faint">{CATEGORY_LABEL[f.category]}</span>
        <span className="ml-auto"><StatusBadge severity={VERDICT[f.verdict].severity}>{VERDICT[f.verdict].label}</StatusBadge></span>
      </div>
      {f.reason && <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">{f.reason}</p>}
      <p className="mt-1.5 text-[12px] leading-relaxed text-ink">
        <span className="text-ink-faint">{f.measurement ? "Checked: " : ""}</span>{f.verdictText}
      </p>
      {f.engineFlagged && <p className="mt-1 text-[11.5px] text-ink-faint">The engine&apos;s own leakage check flags this column too.</p>}
    </li>
  );
}

function ReviewResult({ review, target, onAskAgain }) {
  const sorted = [...review.findings].sort((a, b) => VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict));
  /* Three lists, because the three make different kinds of claim and one heading
     cannot be true of all of them. A relevance remark carries a real measurement and
     is not an accusation, so it belongs under neither of the other two. */
  const isRelevance = (f) => RELEVANCE_CATEGORIES.includes(f.category);
  const findings  = sorted.filter((f) => !isRelevance(f) && MEASURED.includes(f.verdict));
  const questions = sorted.filter((f) => !isRelevance(f) && !MEASURED.includes(f.verdict));
  const remarks   = sorted.filter(isRelevance);

  return (
    <div className="mt-5 space-y-6">
      <p className="font-mono text-[11px] text-ink-faint">
        answered by {review.model ?? "an unknown model"}
        {" · "}
        <button type="button" onClick={onAskAgain} className="inline-flex items-center gap-1 hover:text-ink">
          <RotateCcw size={11} /> ask again
        </button>
      </p>

      {review.split && (
        <section className="rounded-xl border border-line bg-paper px-4 py-3.5">
          <h3 className="text-[11px] font-medium text-ink-faint">How to split for evaluation</h3>
          <div className="mt-1.5 text-[13.5px] text-ink">
            {SPLIT_LABEL[review.split.strategy]}
            {review.split.column && <> <span className="font-mono">{review.split.column}</span></>}
          </div>
          {review.split.reason && <p className="mt-1 text-[12.5px] leading-relaxed text-ink-soft">{review.split.reason}</p>}
          {review.split.note && <p className="mt-1 font-mono text-[11.5px] text-ink-faint">Measured: {review.split.note}</p>}
        </section>
      )}

      <section>
        <h3 className="text-[11px] font-medium text-ink-faint">
          {findings.length === 0 ? "No leakage concern was measured" : `${findings.length} concern${findings.length > 1 ? "s" : ""} measured against ${target}`}
        </h3>
        {findings.length > 0 && (
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-paper">
            {findings.map((f) => <FindingRow key={`${f.column}|${f.category}`} f={f} />)}
          </ul>
        )}
      </section>

      {questions.length > 0 && (
        <section>
          <h3 className="text-[11px] font-medium text-ink-faint">
            {questions.length} question{questions.length > 1 ? "s" : ""} the data cannot answer
          </h3>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-faint">
            These depend on what a column means — when it was recorded, or whether it names an
            entity — which the data cannot show. None of it is evidence against a column.
          </p>
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-paper">
            {questions.map((f) => <FindingRow key={`${f.column}|${f.category}`} f={f} />)}
          </ul>
        </section>
      )}

      {remarks.length > 0 && (
        <section>
          <h3 className="text-[11px] font-medium text-ink-faint">
            {remarks.length} remark{remarks.length > 1 ? "s" : ""} on whether the numbers fit the columns
          </h3>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-faint">
            Not leakage: each asks whether a measured association fits what the column means.
            The engine&apos;s number is quoted in each, including where it disagrees.
          </p>
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-paper">
            {remarks.map((f) => <FindingRow key={`${f.column}|${f.category}`} f={f} />)}
          </ul>
        </section>
      )}

      {review.engineOnly.length > 0 && (
        <section className="text-[12.5px] leading-relaxed text-ink-soft">
          <h3 className="text-[11px] font-medium text-ink-faint">Flagged by the engine, not raised by the model</h3>
          <ul className="mt-1.5 space-y-1">
            {review.engineOnly.map((e) => <li key={e.column}><span className="font-mono text-ink">{e.column}</span> — {e.warning}</li>)}
          </ul>
        </section>
      )}

      {/* Measured by the engine before the request (prep/sameTarget.js): evidence, not a
          verdict — an entity, a value known only afterwards, or harmless. The model had
          the numbers and did not raise these; the reader decides. */}
      {review.sameTargetNotRaised?.length > 0 && (
        <section className="text-[12.5px] leading-relaxed text-ink-soft">
          <h3 className="text-[11px] font-medium text-ink-faint">Rows sharing a value share the target — measured, not raised by the model</h3>
          <ul className="mt-1.5 space-y-1">
            {review.sameTargetNotRaised.map((s) => (
              <li key={s.column}>
                <span className="font-mono text-ink">{s.column}</span> — {s.repeatedRows.toLocaleString()} rows repeat one of its{" "}
                {s.values.toLocaleString()} values, and within those the target is the same {Math.round(s.sameTargetShare * 100)}% of the time
                (the most common target value alone: {Math.round(s.overallShare * 100)}%). If it identifies an entity, split by it; if it is only
                known after the outcome, leave it out.
              </li>
            ))}
          </ul>
        </section>
      )}

      {review.withheld.length > 0 && (
        <details className="text-[12.5px] text-ink-soft">
          <summary className="cursor-pointer hover:text-ink">
            {review.withheld.length} item{review.withheld.length > 1 ? "s" : ""} withheld because the file did not support {review.withheld.length > 1 ? "them" : "it"}
          </summary>
          <ul className="mt-2 space-y-1 font-mono text-[11.5px] text-ink-faint">
            {review.withheld.map((w, i) => <li key={i}>{w.column}: {w.reason}</li>)}
          </ul>
        </details>
      )}

      <p className="border-t border-line pt-4 text-[11.5px] text-ink-faint">
        Advisory only — nothing here changes the engine&apos;s leakage flags, the health score or the recommendations.
      </p>
    </div>
  );
}

export default AiLeakageReview;
