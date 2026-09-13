import { useEffect, useRef, useState } from "react";
import { LoaderCircle, TriangleAlert, X, RotateCcw, Sparkles } from "lucide-react";

import { buildDossierPayload, verifyDossier } from "../../../lib/ai/dossier.js";
import { requestAi } from "../../../lib/ai/requestAi.js";
import { askDossier } from "../../../lib/ai/askDossier.js";
import AiBadge  from "../shared/AiBadge.jsx";
import RolePill from "../shared/RolePill.jsx";

/* AI phase B on the target picker: what each column is, and which column is the
   likely target. The model only SUGGESTS. Every claim is checked against the file
   by verifyDossier() before it renders, and nothing reaches the engine unless the
   user ticks it — then only as a roleOverride.

   The verified dossier and the accepted overrides are owned by Analyze.jsx, not
   here: Cancel on the processing step unmounts this component, and a finished
   answer costs a request from a small daily quota. */
function AiDossier({ data, columns, roles, dossier, onDossier, overrides, onOverridesChange, onUseTarget, currentTarget }) {
  const [status, setStatus]   = useState("idle");   // idle | loading | error
  const [failure, setFailure] = useState(null);
  const [preview, setPreview] = useState(null);
  const runRef = useRef(null);

  // Leaving the picker mid-request: stop waiting for an answer nobody will see.
  useEffect(() => () => runRef.current?.abort(), []);

  const payload = () => buildDossierPayload(data, columns, roles);

  const handleAsk = async () => {
    const run = new AbortController();
    runRef.current = run;
    setStatus("loading");
    setFailure(null);

    const { result, model, error, detail, aborted } = await askDossier(payload(), (part) => requestAi("dossier", part, run.signal));
    if (aborted) return;
    const verified = error ? null : verifyDossier(result, { data, columns, roles });
    if (error || verified.error) {
      setFailure({ error: error ?? verified.error, detail });
      setStatus("error");
      return;
    }
    onDossier({ ...verified, model });
    setStatus("idle");
  };

  const handleCancel = () => {
    runRef.current?.abort();
    setStatus("idle");
  };

  const toggleOverride = (col, role) => {
    const next = { ...overrides };
    if (next[col] === role) delete next[col];
    else next[col] = role;
    onOverridesChange(next);
  };

  return (
    <div className="mt-6 rounded-[2rem] border border-dashed border-line-strong bg-paper-sunken p-6 sm:p-8">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint">AI assistant</h2>
        <span className="h-px min-w-4 flex-1 bg-line" />
        <AiBadge>Optional · not measured</AiBadge>
      </div>

      {status === "loading" && (
        <div className="mt-6 flex flex-wrap items-center gap-3 text-[13px] text-ink-soft">
          <LoaderCircle size={16} className="animate-spin text-accent-ink" />
          Waiting for the model. Free models can take a minute, and a file over 25 columns is asked in parts.
          <button type="button" onClick={handleCancel} className="inline-flex items-center gap-1 font-medium text-ink-soft hover:text-ink">
            <X size={13} /> Cancel
          </button>
        </div>
      )}

      {status === "error" && (
        <div className="mt-6 rounded-xl border border-line bg-paper px-4 py-3.5">
          <div className="flex items-start gap-2.5 text-[13px] leading-relaxed text-ink">
            <TriangleAlert size={14} className="mt-0.5 shrink-0 text-warning" />
            <div>
              {failure?.error}
              {failure?.detail && <div className="mt-1 font-mono text-[11.5px] text-ink-faint">{failure.detail}</div>}
              <div className="mt-1 text-[12.5px] text-ink-soft">The analysis itself does not depend on this — you can start it now.</div>
            </div>
          </div>
        </div>
      )}

      {status !== "loading" && !dossier && (
        <>
          <p className="mt-6 text-[13.5px] leading-[1.7] text-ink-soft">
            Ask a language model what each column records and which one is most likely the
            target. It suggests; nothing changes unless you accept it, and every value it
            quotes is checked against your file first.
          </p>
          <p className="mt-3 text-[12.5px] leading-[1.7] text-ink-faint">
            Sent to OpenRouter's free models, which may log or train on requests: column
            names, per-column counts and summary statistics, up to 8 frequent values and 5
            example values per column. No rows, and no values from free-text columns.
          </p>
          <details
            className="mt-3 text-[12.5px] text-ink-soft"
            onToggle={(e) => { if (e.currentTarget.open && !preview) setPreview(JSON.stringify(payload(), null, 2)); }}
          >
            <summary className="cursor-pointer font-medium hover:text-ink">
              Show exactly what is sent{preview && ` (${(preview.length / 1024).toFixed(1)} KB)`}
            </summary>
            {preview && (
              <pre className="mt-3 max-h-72 overflow-auto rounded-xl border border-line bg-paper p-4 font-mono text-[11px] leading-relaxed text-ink-soft">
                {preview}
              </pre>
            )}
          </details>
          <button
            type="button"
            onClick={handleAsk}
            className="mt-6 inline-flex items-center gap-2 rounded-xl border border-line-strong px-5 py-2.5 text-[13px] font-semibold text-ink transition-colors hover:bg-accent-tint"
          >
            <Sparkles size={14} />
            {status === "error" ? "Try again" : "Ask AI about these columns"}
          </button>
        </>
      )}

      {status !== "loading" && dossier && (
        <DossierResult
          dossier={dossier}
          overrides={overrides}
          onToggleOverride={toggleOverride}
          onUseTarget={onUseTarget}
          currentTarget={currentTarget}
          onAskAgain={handleAsk}
        />
      )}
    </div>
  );
}

function DossierResult({ dossier, overrides, onToggleOverride, onUseTarget, currentTarget, onAskAgain }) {
  // Disagreements first: they are the only rows that ask the user for a decision.
  const cols = [...dossier.columns].sort((a, b) => Number(a.agrees) - Number(b.agrees));
  const disagreements = cols.filter((c) => !c.agrees).length;

  return (
    <div className="mt-6 space-y-8">
      <div className="text-[12.5px] leading-relaxed text-ink-soft">
        {dossier.rowGrain && <p><span className="text-ink-faint">One row is:</span> <span className="text-ink">{dossier.rowGrain}</span></p>}
        <p className="mt-1 font-mono text-[11px] text-ink-faint">
          answered by {dossier.model ?? "an unknown model"}
          {" · "}
          <button type="button" onClick={onAskAgain} className="inline-flex items-center gap-1 hover:text-ink">
            <RotateCcw size={11} /> ask again
          </button>
        </p>
      </div>

      <section>
        <h3 className="text-[11px] font-medium text-ink-faint">Suggested targets</h3>
        {dossier.targets.length === 0 ? (
          <p className="mt-2 text-[13px] text-ink-soft">No usable target was suggested.</p>
        ) : (
          <ol className="mt-2 space-y-2">
            {dossier.targets.map((t) => (
              <li key={t.column} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-line bg-paper px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[13px] text-ink">
                    {t.column}
                    {t.task && <span className="ml-2 text-[11px] text-ink-faint">{t.task}</span>}
                  </div>
                  <div className="mt-1 text-[12.5px] leading-relaxed text-ink-soft">{t.reason}</div>
                </div>
                {currentTarget === t.column ? (
                  <span className="text-[12px] text-ink-faint">selected</span>
                ) : (
                  <button type="button" onClick={() => onUseTarget(t.column)} className="rounded-lg border border-line-strong px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-accent-tint">
                    Use as target
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section>
        <h3 className="text-[11px] font-medium text-ink-faint">
          Columns · {disagreements === 0 ? "the model agrees with every detected role" : `${disagreements} role${disagreements > 1 ? "s" : ""} read differently`}
        </h3>
        <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-paper">
          {cols.map((c) => (
            <ColumnRow key={c.name} col={c} accepted={overrides[c.name] === c.role} onToggle={() => onToggleOverride(c.name, c.role)} />
          ))}
        </ul>
      </section>

      {(dossier.withheld.length > 0 || dossier.undescribed.length > 0) && (
        <section className="text-[12.5px] leading-relaxed text-ink-soft">
          {dossier.withheld.length > 0 && (
            <details>
              <summary className="cursor-pointer hover:text-ink">
                {dossier.withheld.length} suggestion{dossier.withheld.length > 1 ? "s" : ""} withheld because the file did not support {dossier.withheld.length > 1 ? "them" : "it"}
              </summary>
              <ul className="mt-2 space-y-1 font-mono text-[11.5px] text-ink-faint">
                {dossier.withheld.map((w, i) => <li key={i}>{w.column}: {w.reason}</li>)}
              </ul>
            </details>
          )}
          {dossier.undescribed.length > 0 && (
            <p className="mt-2">Not described by the model: <span className="font-mono text-[11.5px]">{dossier.undescribed.join(", ")}</span></p>
          )}
        </section>
      )}
    </div>
  );
}

function ColumnRow({ col, accepted, onToggle }) {
  const facts = [
    col.subtype && col.subtype.replace("_", " "),
    col.unit && `unit: ${col.unit}`,
    col.validRange && `plausible range ${col.validRange.min ?? "…"} to ${col.validRange.max ?? "…"}`,
    col.confidence && `${col.confidence} confidence`,
  ].filter(Boolean);

  return (
    <li className="px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[13px] text-ink">{col.name}</span>
        <RolePill role={col.engineRole} />
        {!col.agrees && (
          <>
            <span className="text-[11px] text-ink-faint">AI reads</span>
            <RolePill role={col.role} />
          </>
        )}
      </div>
      {col.meaning && <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">{col.meaning}</p>}
      {facts.length > 0 && <p className="mt-1 font-mono text-[11px] text-ink-faint">{facts.join(" · ")}</p>}

      {col.outOfRange > 0 && (
        <p className="mt-1.5 text-[12px] text-ink-soft">
          <span className="font-mono text-ink">{col.outOfRange.toLocaleString()}</span> values fall outside that range (counted by the engine).
        </p>
      )}
      {col.subtypeContradiction && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[12px] text-ink-soft">
          <TriangleAlert size={12} className="mt-0.5 shrink-0 text-warning" />
          Contradicted by the data: "{col.subtype}", but {col.subtypeContradiction}.
        </p>
      )}
      {col.evidence.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-[11.5px] leading-relaxed text-ink-faint">
          {col.evidence.map((e, i) => <li key={i}>— {e}</li>)}
        </ul>
      )}

      {!col.agrees && (col.roleContradiction ? (
        <p className="mt-2 flex items-start gap-1.5 text-[12px] text-ink-soft">
          <TriangleAlert size={12} className="mt-0.5 shrink-0 text-warning" />
          Not offered: the data contradicts "{col.role}" — {col.roleContradiction}.
        </p>
      ) : (
        <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-[12.5px] text-ink">
          <input type="checkbox" checked={accepted} onChange={onToggle} className="h-3.5 w-3.5 accent-current" />
          Analyze "{col.name}" as {col.role} instead of {col.engineRole}
        </label>
      ))}
    </li>
  );
}

export default AiDossier;
