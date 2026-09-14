import { useEffect, useRef, useState } from "react";
import { RotateCcw, Sparkles } from "lucide-react";

import { buildPlanPayload, verifyPlan, recommendationId } from "../../../../lib/ai/plan.js";
import { requestAi } from "../../../../lib/ai/requestAi.js";
import AiPanel          from "../../shared/AiPanel.jsx";
import AiPayloadPreview from "../../shared/AiPayloadPreview.jsx";

/* AI phase E on the Overview tab: the report's recommendations put in order, and
   the report explained in plain language. It adds no facts — every step points at
   the engine's own recommendations, a sentence with a number the report does not
   contain is removed before it is shown, and the deterministic recommendation list
   beside it stays exactly as it was. Held by Analyze.jsx; cleared by a new analysis. */

const PRIORITY_TEXT = { high: "text-critical", medium: "text-warning", low: "text-ink-faint" };

function AiPlan({ result, ai }) {
  const { planReview: review, onPlanReview, cleaningRules, leakageReview } = ai;
  const [status, setStatus]   = useState("idle");
  const [failure, setFailure] = useState(null);
  const runRef = useRef(null);

  useEffect(() => () => runRef.current?.abort(), []);

  const payload = () => buildPlanPayload(result, { cleaningRules, leakageReview });

  const handleAsk = async () => {
    const run = new AbortController();
    runRef.current = run;
    setStatus("loading");
    setFailure(null);
    const built = payload();
    const reply = await requestAi("plan", built, run.signal);
    if (reply.aborted) return;
    const verified = reply.error ? null : verifyPlan(reply.result, built);
    if (reply.error || verified.error) {
      setFailure({ error: reply.error ?? verified.error, detail: reply.detail });
      setStatus("error");
      return;
    }
    onPlanReview({ ...verified, model: reply.model });
    setStatus("idle");
  };

  const recs = result.recommendations ?? [];
  const byId = new Map(recs.map((r, i) => [recommendationId(i), r]));

  return (
    <AiPanel
      title="Plan in plain language"
      size="report"
      status={status}
      failure={failure}
      onCancel={() => { runRef.current?.abort(); setStatus("idle"); }}
      loadingText="Waiting for the model — free models can take a minute."
    >
      {!review && (
        <>
          <p className="mt-5 text-[13px] leading-[1.7] text-ink-soft">
            Ask a language model to put the {recs.length} recommendations below in order and explain the
            report without statistics. It adds no facts: every step points at the engine&apos;s own
            recommendations, and any sentence with a number the report does not contain is removed.
          </p>
          <p className="mt-3 text-[12px] leading-[1.7] text-ink-faint">
            Sent to OpenRouter&apos;s free models, which may log or train on requests: the health score and its
            limits, the recommendations and insight cards as written (they name columns and quote a few
            values), and the decisions you made. No rows.
          </p>
          <AiPayloadPreview build={payload} />
          <button type="button" onClick={handleAsk} className="mt-5 inline-flex items-center gap-2 rounded-xl border border-line-strong px-5 py-2.5 text-[13px] font-semibold text-ink transition-colors hover:bg-accent-tint">
            <Sparkles size={14} /> {status === "error" ? "Try again" : "Write the plan"}
          </button>
        </>
      )}

      {review && (
        <div className="mt-5 space-y-5">
          <p className="font-mono text-[11px] text-ink-faint">
            answered by {review.model ?? "an unknown model"} ·{" "}
            <button type="button" onClick={handleAsk} className="inline-flex items-center gap-1 hover:text-ink"><RotateCcw size={11} /> ask again</button>
          </p>

          {review.summary && <p className="text-[14px] leading-[1.75] text-ink">{review.summary}</p>}

          {review.steps.length > 0 && (
            <ol className="space-y-3">
              {review.steps.map((s, i) => (
                <li key={i} className="rounded-xl border border-line bg-paper px-4 py-3.5">
                  <div className="flex items-baseline gap-3">
                    <span className="font-mono text-[11px] text-ink-faint">{String(i + 1).padStart(2, "0")}</span>
                    <span className="text-[13.5px] font-medium text-ink">{s.title}</span>
                  </div>
                  {s.why && <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-soft">{s.why}</p>}
                  <ul className="mt-2 space-y-1">
                    {s.recommendationIds.map((id) => {
                      const r = byId.get(id);
                      return (
                        <li key={id} className="text-[12px] leading-relaxed text-ink-soft">
                          <span className={`font-mono text-[10.5px] uppercase ${PRIORITY_TEXT[r.priority] ?? "text-ink-faint"}`}>{r.priority}</span>{" "}
                          {r.issue}{r.column && <> — <span className="font-mono text-ink">{r.column}</span></>}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ol>
          )}

          {review.notInPlan.length > 0 && (
            <p className="text-[12.5px] leading-relaxed text-ink-soft">
              <span className="text-ink-faint">High-priority items the plan left out: </span>
              {review.notInPlan.map((id) => byId.get(id)?.issue).join("; ")}.
            </p>
          )}

          {(review.removed.length > 0 || review.withheld.length > 0) && (
            <details className="text-[12.5px] text-ink-soft">
              <summary className="cursor-pointer hover:text-ink">
                {review.removed.length} sentence{review.removed.length === 1 ? "" : "s"} removed for a number the report does not contain
                {review.withheld.length > 0 && `, ${review.withheld.length} step reference${review.withheld.length === 1 ? "" : "s"} withheld`}
              </summary>
              <ul className="mt-2 space-y-1 font-mono text-[11.5px] text-ink-faint">
                {review.removed.map((r, i) => <li key={`r${i}`}>{r.where}: &quot;{r.number}&quot; in “{r.sentence}”</li>)}
                {review.withheld.map((w, i) => <li key={`w${i}`}>step {w.step}: {w.reason}</li>)}
              </ul>
            </details>
          )}

          <p className="border-t border-line pt-4 text-[11.5px] text-ink-faint">
            The engine&apos;s recommendation list below is unchanged — this plan only orders and explains it.
          </p>
        </div>
      )}
    </AiPanel>
  );
}

export default AiPlan;
