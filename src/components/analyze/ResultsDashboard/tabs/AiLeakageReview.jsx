import { RotateCcw, Sparkles } from "lucide-react";

import { buildLeakagePayload } from "../../../../lib/ai/leakage.js";
import AiPanel          from "../../shared/AiPanel.jsx";
import AiPayloadPreview from "../../shared/AiPayloadPreview.jsx";
import StatusBadge      from "../../shared/StatusBadge.jsx";

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
      title="AI leakage review"
      size="report"
      status={status}
      failure={failure}
      onCancel={onCancel}
      loadingText="Reviewing the report for leakage — free models can take a minute. Nothing else waits for it."
    >
      {!review && (
        <>
          <p className="mt-5 text-[13px] leading-[1.7] text-ink-soft">
            Ask a language model which columns a model could not use when making a real
            prediction: computed from the target, known only after the outcome, the label
            under another name, or an entity repeated across rows. Every formula it proposes
            is evaluated on your rows, and every group claim is measured, before it is shown.
          </p>
          <p className="mt-3 text-[12px] leading-[1.7] text-ink-faint">
            Sent to OpenRouter&apos;s free models, which may log or train on requests: column names
            and roles, the engine&apos;s measured associations and column means
            {dossier ? ", and the column meanings from the AI dossier" : ""}. No cell values.
          </p>
          <AiPayloadPreview build={payload} />
          <button
            type="button"
            onClick={onAsk}
            className="mt-5 inline-flex items-center gap-2 rounded-xl border border-line-strong px-5 py-2.5 text-[13px] font-semibold text-ink transition-colors hover:bg-accent-tint"
          >
            <Sparkles size={14} />
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
  const findings = sorted.filter((f) => MEASURED.includes(f.verdict));
  const questions = sorted.filter((f) => !MEASURED.includes(f.verdict));

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
            These rest on what the columns are taken to mean — when they were recorded, whether a
            value repeats an entity rather than a category, whether one number is built from
            another. Nothing here was measured, and none of it is evidence against a column.
          </p>
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-paper">
            {questions.map((f) => <FindingRow key={`${f.column}|${f.category}`} f={f} />)}
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
