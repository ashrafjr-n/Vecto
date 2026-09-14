import { useEffect, useRef, useState } from "react";
import { RotateCcw, Sparkles, ScanSearch, Copy, Check } from "lucide-react";

import { detectColumnRoles } from "../../../utils/core/detectors/roles.js";
import { findCleaningCandidates, buildCleaningPayload, verifyCleaningRules, cleaningRulesToPandas } from "../../../../lib/ai/cleaning.js";
import { requestAi } from "../../../../lib/ai/requestAi.js";
import AiPanel          from "../../shared/AiPanel.jsx";
import AiPayloadPreview from "../../shared/AiPayloadPreview.jsx";
import AiBadge          from "../../shared/AiBadge.jsx";

/* AI phase D on the Quality tab, in two steps.

   1. The ENGINE scans the original file for cleaning candidates — numbers written
      with units or bounds, category spellings that collide, placeholder values.
      Deterministic and free; useful on its own.
   2. Only then can the model be asked what they mean, as rules in a closed format.
      Every rule is applied to a copy and measured (verifyCleaningRules) before it
      can be ticked, and nothing changes until the user re-runs the analysis with
      the rules they accepted — which Analyze.jsx does on the original rows.

   Candidates are always found on the ORIGINAL file, so removing rules and asking
   again starts from what was uploaded, not from an already-cleaned copy. */

const TYPE_LABEL = {
  unit_map:         "Convert units",
  censored_numeric: "Read bounds as numbers",
  treat_as_missing: "Treat as missing",
  merge_levels:     "Merge spellings",
};

const pct = (x) => `${Math.round(x * 1000) / 10}%`;

function describeRule(r) {
  if (r.type === "unit_map") return r.affixes.map((a) => `"${a.affix}" × ${a.factor.toLocaleString()}`).join(", ");
  if (r.type === "censored_numeric") return r.affixes.map((a) => `"${a.affix}" → the number itself`).join(", ");
  if (r.type === "treat_as_missing") return r.values.map((v) => `"${v}"`).join(", ");
  return r.merges.map((m) => `"${m.from}" → "${m.to}"`).join(", ");
}

function AiCleaningProposals({ result, ai }) {
  const { originalData, dossier, cleaningRules, onApplyCleaning, cleaning, onCleaning } = ai;
  const [status, setStatus]   = useState("idle");   // idle | scanning | loading | error
  const [failure, setFailure] = useState(null);
  const [picked, setPicked]   = useState(() => new Set(cleaningRules.map((r) => `${r.column}|${r.type}`)));
  const runRef = useRef(null);

  useEffect(() => () => runRef.current?.abort(), []);

  const columns = Object.keys(result.meta.columnRoles);
  const candidates = cleaning?.candidates ?? null;
  const proposal = cleaning?.proposal ?? null;

  const handleScan = () => {
    setStatus("scanning");
    // Yield one frame so "Scanning" paints before a full pass over a large file blocks the thread.
    setTimeout(() => {
      const roles = detectColumnRoles(originalData, columns, null);
      onCleaning({ candidates: findCleaningCandidates(originalData, columns, roles), proposal: null });
      setStatus("idle");
    }, 30);
  };

  const payload = () => buildCleaningPayload(candidates, originalData.length, dossier);

  const handleAsk = async () => {
    const run = new AbortController();
    runRef.current = run;
    setStatus("loading");
    setFailure(null);
    const reply = await requestAi("cleaning", payload(), run.signal);
    if (reply.aborted) return;
    const verified = reply.error ? null : verifyCleaningRules(reply.result, { data: originalData, columns, candidates });
    if (reply.error || verified.error) {
      setFailure({ error: reply.error ?? verified.error, detail: reply.detail });
      setStatus("error");
      return;
    }
    onCleaning({ candidates, proposal: { ...verified, model: reply.model } });
    setStatus("idle");
  };

  const toggle = (key) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const chosen = (proposal?.rules ?? []).filter((r) => r.effective && picked.has(`${r.column}|${r.type}`));

  return (
    <AiPanel
      title="Cleaning proposals"
      size="report"
      status={status}
      failure={failure}
      onCancel={() => { runRef.current?.abort(); setStatus("idle"); }}
      loadingText="Waiting for the model — free models can take a minute."
    >
      {cleaningRules.length > 0 && <AppliedRules rules={cleaningRules} onRemoveAll={() => onApplyCleaning([])} />}

      {status === "scanning" && <p className="mt-5 text-[13px] text-ink-soft">Scanning the original file for cleaning candidates…</p>}

      {status !== "scanning" && !candidates && (
        <>
          <p className="mt-5 text-[13px] leading-[1.7] text-ink-soft">
            The engine first scans the file for values that look dirty: numbers written with a
            unit or bound (&quot;42 Lac&quot;, &quot;125+&quot;), one category spelled several ways, placeholder
            values such as -999. That scan runs here and sends nothing.
          </p>
          <button type="button" onClick={handleScan} className="mt-5 inline-flex items-center gap-2 rounded-xl border border-line-strong px-5 py-2.5 text-[13px] font-semibold text-ink transition-colors hover:bg-accent-tint">
            <ScanSearch size={14} /> Scan for cleaning candidates
          </button>
        </>
      )}

      {status !== "scanning" && candidates && !proposal && (
        <>
          <CandidateSummary candidates={candidates} />
          {candidates.length > 0 && (
            <>
              <p className="mt-4 text-[12px] leading-[1.7] text-ink-faint">
                Asking a language model sends these candidates to OpenRouter&apos;s free models, which may log or
                train on requests: column names, each affix or spelling with its count, and up to 3 example
                values per group{dossier ? ", plus column meanings from the AI dossier" : ""}. No rows.
              </p>
              <AiPayloadPreview build={payload} />
              <button type="button" onClick={handleAsk} className="mt-5 inline-flex items-center gap-2 rounded-xl border border-line-strong px-5 py-2.5 text-[13px] font-semibold text-ink transition-colors hover:bg-accent-tint">
                <Sparkles size={14} /> {status === "error" ? "Try again" : "Ask AI what they mean"}
              </button>
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
            <ul className="divide-y divide-line rounded-xl border border-line bg-paper">
              {proposal.rules.map((r) => {
                const key = `${r.column}|${r.type}`;
                const m = r.measurement;
                return (
                  <li key={key} className="px-4 py-3.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[13px] text-ink">{r.column}</span>
                      <span className="text-[11.5px] text-ink-faint">{TYPE_LABEL[r.type]}</span>
                    </div>
                    <p className="mt-1 font-mono text-[11.5px] text-ink-soft">{describeRule(r)}</p>
                    {r.reason && <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">{r.reason}</p>}
                    <p className="mt-1.5 text-[12px] leading-relaxed text-ink">
                      <span className="text-ink-faint">Applied to a copy: </span>
                      {m.rowsChanged.toLocaleString()} values changed
                      {r.type === "merge_levels"
                        ? `; ${m.levelsBefore.toLocaleString()} → ${m.levelsAfter.toLocaleString()} distinct levels`
                        : `; values that are numbers ${pct(m.numericShareBefore)} → ${pct(m.numericShareAfter)}`}.
                    </p>
                    {m.examples.length > 0 && (
                      <p className="mt-1 font-mono text-[11px] text-ink-faint">{m.examples.map((e) => `${e.before} → ${e.after}`).join("   ·   ")}</p>
                    )}
                    {r.effective ? (
                      <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-[12.5px] text-ink">
                        <input type="checkbox" checked={picked.has(key)} onChange={() => toggle(key)} className="h-3.5 w-3.5 accent-current" />
                        Use this rule
                      </label>
                    ) : (
                      <p className="mt-2 text-[12px] text-ink-faint">Not offered: it changes no value in this file.</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {proposal.withheld.length > 0 && (
            <details className="text-[12.5px] text-ink-soft">
              <summary className="cursor-pointer hover:text-ink">{proposal.withheld.length} part{proposal.withheld.length > 1 ? "s" : ""} of the proposal withheld because the file did not support {proposal.withheld.length > 1 ? "them" : "it"}</summary>
              <ul className="mt-2 space-y-1 font-mono text-[11.5px] text-ink-faint">{proposal.withheld.map((w, i) => <li key={i}>{w.column}: {w.reason}</li>)}</ul>
            </details>
          )}

          {chosen.length > 0 && (
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
        {rules.map((r) => <li key={`${r.column}|${r.type}`}>{r.column}: {TYPE_LABEL[r.type].toLowerCase()} — {describeRule(r)}</li>)}
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
