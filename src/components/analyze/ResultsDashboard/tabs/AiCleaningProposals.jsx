import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { RotateCcw, ScanSearch, Copy, Check } from "lucide-react";

import { detectColumnRoles } from "../../../utils/core/detectors/roles.js";
import { findCleaningCandidates, cleaningRulesToPandas } from "../../../../lib/ai/cleaning.js";
import { buildReviewPayload, verifyReview } from "../../../../lib/ai/review.js";
import { requestAi } from "../../../../lib/ai/requestAi.js";
import { askDossier } from "../../../../lib/ai/askDossier.js";
import AiPanel          from "../../shared/AiPanel.jsx";
import AiGate           from "../../shared/AiGate.jsx";
import AiPayloadPreview from "../../shared/AiPayloadPreview.jsx";
import AiBadge          from "../../shared/AiBadge.jsx";
import CleaningRuleList from "../../shared/CleaningRuleList.jsx";
import { TYPE_LABEL, ruleKey, describeRule } from "../../shared/cleaningRuleText.js";

/* AI phase D on the Quality tab, in two steps.

   1. The ENGINE scans the original file for cleaning candidates — numbers written
      with units or bounds, category spellings that collide, placeholder values.
      Deterministic and free; useful on its own.
   2. Only then can the model be asked what they mean, as rules in a closed format.
      That ask is the `review` task — the same single request the target step makes,
      so the answer carries the column dossier as well as the rules. This is the way
      in for a user who reached the report without asking for a review; there is no
      route back to the target picker.
      Every rule is applied to a copy and measured (verifyCleaningRules) before it
      can be ticked, and nothing changes until the user re-runs the analysis with
      the rules they accepted — which Analyze.jsx does on the original rows.

   Candidates are always found on the ORIGINAL file, so removing rules and asking
   again starts from what was uploaded, not from an already-cleaned copy. */

function AiCleaningProposals({ result, ai }) {
  const { originalData, dossier, onDossier, cleaningRules, onApplyCleaning, cleaning, onCleaning, analysisId, onUsage } = ai;
  const [status, setStatus]   = useState("idle");   // idle | scanning | loading | error
  const [failure, setFailure] = useState(null);
  const [picked, setPicked]   = useState(() => new Set(cleaningRules.map(ruleKey)));
  const runRef = useRef(null);
  /* Roles of the ORIGINAL file, cached: every pass is a full read, and the report's
     own roles describe the analysed rows (already cleaned, already overridden). */
  const rolesRef = useRef(null);

  useEffect(() => () => runRef.current?.abort(), []);

  const columns = Object.keys(result.meta.columnRoles);
  const rolesOf = () => (rolesRef.current ??= detectColumnRoles(originalData, columns, null));
  const candidates = cleaning?.candidates ?? null;
  const proposal = cleaning?.proposal ?? null;

  const handleScan = () => {
    setStatus("scanning");
    // Yield one frame so "Scanning" paints before a full pass over a large file blocks the thread.
    setTimeout(() => {
      onCleaning({ candidates: findCleaningCandidates(originalData, columns, rolesOf()), proposal: null });
      setStatus("idle");
    }, 30);
  };

  const payload = () => buildReviewPayload(originalData, columns, rolesOf(), candidates ?? []);

  const handleAsk = async () => {
    // Also an opt-in: a re-run from here builds a new report, which C may then review.
    ai.onOptIn?.();
    const run = new AbortController();
    runRef.current = run;
    setStatus("loading");
    setFailure(null);
    const { result: answer, model, error, detail, aborted, usage } = await askDossier(
      payload(),
      (part) => requestAi("review", part, run.signal, analysisId),
    );
    if (aborted) return;
    onUsage?.(usage);
    const verified = error ? null : verifyReview(answer, { data: originalData, columns, roles: rolesOf(), candidates });
    if (error || verified.error) {
      setFailure({ error: error ?? verified.error, detail });
      setStatus("error");
      return;
    }
    onDossier({ ...verified.dossier, model });
    onCleaning({ candidates, proposal: { ...verified.cleaning, model } });
    setStatus("idle");
  };

  const toggle = (rule) => setPicked((prev) => {
    const key = ruleKey(rule);
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const chosen = (proposal?.rules ?? []).filter((r) => r.effective && picked.has(ruleKey(r)));
  // The button only appears when running would change something — not for the rules already applied.
  const ruleKeys = (rules) => rules.map(ruleKey).sort().join();
  const changesSomething = ruleKeys(chosen) !== ruleKeys(cleaningRules);

  return (
    <AiPanel
      title="Cleaning proposals"
      status={status}
      failure={failure}
      onCancel={() => { runRef.current?.abort(); setStatus("idle"); }}
      loadingText="Waiting for the model — usually under a minute. Files over 25 columns are sent in parts."
    >
      {cleaningRules.length > 0 && <AppliedRules rules={cleaningRules} onRemoveAll={() => onApplyCleaning([])} />}

      {status === "scanning" && <p className="mt-5 text-[13px] text-ink-soft">Scanning the original file for cleaning candidates…</p>}

      {status !== "scanning" && !candidates && (
        <>
          <p className="mt-4 text-[13.5px] leading-relaxed text-ink-soft">
            Finds values that look dirty: numbers written with a unit or bound (&quot;42 Lac&quot;,
            &quot;125+&quot;), one category spelled several ways, placeholders such as -999. The scan
            runs in this tab and sends nothing.
          </p>
          <button type="button" onClick={handleScan} className="mt-5 inline-flex items-center gap-2 rounded-xl border border-line-strong px-4 py-2.5 text-[13px] font-semibold text-ink transition-colors hover:bg-accent-tint">
            <ScanSearch size={14} /> Scan for cleaning candidates
          </button>
        </>
      )}

      {status !== "scanning" && candidates && !proposal && (
        <>
          <CandidateSummary candidates={candidates} />
          {candidates.length > 0 && (
            <>
              <p className="mt-4 text-[13.5px] leading-relaxed text-ink-soft">
                The column review can propose a rule for each one. Every rule is measured on a copy
                of your file before you can tick it{dossier ? "" : ", and the answer also describes each column"}.
              </p>
              <AiPayloadPreview
                build={payload}
                sent={<>Sends a summary of every column with these values, never rows, to OpenRouter&apos;s free models, which may log requests. <Link to="/privacy" className="underline decoration-line-strong underline-offset-2 hover:text-ink">Privacy</Link></>}
              />
              <AiGate>
                <button type="button" onClick={handleAsk} className="mt-5 inline-flex items-center rounded-xl border border-line-strong px-4 py-2.5 text-[13px] font-semibold text-ink transition-colors hover:bg-accent-tint">
                  {status === "error" ? "Try again" : "Propose cleaning rules"}
                </button>
              </AiGate>
            </>
          )}
        </>
      )}

      {proposal && (
        <div className="mt-5 space-y-5">
          <p className="font-mono text-[11px] text-ink-faint">
            answered by {proposal.model ?? "an unknown model"} ·{" "}
            <button type="button" onClick={handleAsk} className="inline-flex items-center gap-1 hover:text-ink"><RotateCcw size={11} /> ask again</button>
          </p>

          {proposal.rules.length === 0 ? (
            <p className="text-[13px] text-ink-soft">The model proposed no rules for these candidates.</p>
          ) : (
            <CleaningRuleList rules={proposal.rules} picked={picked} onToggle={toggle} />
          )}

          {proposal.withheld.length > 0 && (
            <details className="text-[12.5px] text-ink-soft">
              <summary className="cursor-pointer hover:text-ink">{proposal.withheld.length} part{proposal.withheld.length > 1 ? "s" : ""} of the proposal withheld because the file did not support {proposal.withheld.length > 1 ? "them" : "it"}</summary>
              <ul className="mt-2 space-y-1 font-mono text-[11.5px] text-ink-faint">{proposal.withheld.map((w, i) => <li key={i}>{w.column}: {w.reason}</li>)}</ul>
            </details>
          )}

          {chosen.length > 0 && changesSomething && (
            <button type="button" onClick={() => onApplyCleaning(chosen)} className="inline-flex items-center gap-2 rounded-xl bg-ink px-5 py-2.5 text-[13px] font-semibold text-paper transition-opacity hover:opacity-90">
              Re-run the analysis with {chosen.length} rule{chosen.length > 1 ? "s" : ""}
            </button>
          )}
          <p className="border-t border-line pt-4 text-[11.5px] text-ink-faint">
            Nothing changes until you re-run. The rules are applied to the file as uploaded, and the report then says so.
          </p>
        </div>
      )}
    </AiPanel>
  );
}

function CandidateSummary({ candidates }) {
  if (candidates.length === 0) {
    return <p className="mt-5 text-[13px] text-ink-soft">The engine found no cleaning candidates in this file — nothing to ask about.</p>;
  }
  const kindText = {
    numeric_affix: (c) => `numbers written with ${c.affixes.map((a) => `"${a.affix}" (${a.count.toLocaleString()})`).join(", ")}`,
    level_collision: (c) => `${c.groups.length} group${c.groups.length > 1 ? "s" : ""} of spellings, e.g. ${c.groups[0].map(([v]) => `"${v}"`).join(" / ")}`,
    sentinel: (c) => `placeholder ${c.value} on ${c.count.toLocaleString()} rows`,
  };
  return (
    <div className="mt-5">
      <h3 className="text-[11px] font-medium text-ink-faint">Found by the engine in {candidates.length} column{candidates.length > 1 ? "s" : ""}</h3>
      <ul className="mt-2 space-y-1.5 text-[12.5px] leading-relaxed text-ink-soft">
        {candidates.map((col) => (
          <li key={col.name}><span className="font-mono text-ink">{col.name}</span> — {col.candidates.map((c) => kindText[c.kind](c)).join("; ")}</li>
        ))}
      </ul>
    </div>
  );
}

function AppliedRules({ rules, onRemoveAll }) {
  const [copied, setCopied] = useState(false);
  const code = cleaningRulesToPandas(rules);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);   // clipboard refused (insecure context or denied) — the code stays selectable below
    }
  };
  return (
    <section className="mt-5 rounded-xl border border-line bg-paper px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[12.5px] font-medium text-ink">This report was built after {rules.length} cleaning rule{rules.length > 1 ? "s" : ""}</h3>
        <AiBadge>set by you</AiBadge>
      </div>
      <ul className="mt-2 space-y-1 font-mono text-[11.5px] text-ink-soft">
        {rules.map((r) => <li key={ruleKey(r)}>{r.column}: {TYPE_LABEL[r.type].toLowerCase()} — {describeRule(r)}</li>)}
      </ul>
      <details className="mt-3 text-[12.5px] text-ink-soft">
        <summary className="cursor-pointer font-medium hover:text-ink">Reproduce in pandas</summary>
        <div className="mt-2 flex justify-end">
          <button type="button" onClick={copy} className="inline-flex items-center gap-1 text-[12px] text-ink-soft hover:text-ink">
            {copied ? <><Check size={12} /> copied</> : <><Copy size={12} /> copy</>}
          </button>
        </div>
        <pre className="mt-1 max-h-72 overflow-auto rounded-lg border border-line bg-paper-sunken p-3 font-mono text-[11px] leading-relaxed text-ink-soft">{code}</pre>
      </details>
      <button type="button" onClick={onRemoveAll} className="mt-3 text-[12px] font-medium text-ink-soft underline-offset-2 hover:text-ink hover:underline">
        Remove all rules and re-run
      </button>
    </section>
  );
}

export default AiCleaningProposals;
