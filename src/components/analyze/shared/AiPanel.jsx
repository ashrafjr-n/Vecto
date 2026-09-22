import { useState } from "react";
import { LoaderCircle, TriangleAlert, X } from "lucide-react";
import AiBadge from "./AiBadge.jsx";
import { cachedCount, clearCache } from "../../../lib/ai/answerCache.js";

/* The frame every AI feature sits in: the report's own panel surface, a title
   with the AI label, and the loading and error states — so a slow or failed model
   call looks the same on the target picker and in the report, and always says
   that nothing else depends on it. The feature renders its own idle and result
   content as children. */
function AiPanel({ title, status, failure, loadingText, onCancel, className = "", children }) {
  return (
    <div className={`rounded-2xl border border-line bg-paper-sunken p-5 sm:p-6 ${className}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-[14px] font-semibold tracking-tight text-ink">{title}</h2>
        <AiBadge>optional</AiBadge>
      </div>

      {status === "loading" && (
        <div className="mt-5 flex flex-wrap items-center gap-3 text-[13px] text-ink-soft">
          <LoaderCircle size={16} className="animate-spin text-accent-ink" />
          {loadingText}
          <button type="button" onClick={onCancel} className="inline-flex items-center gap-1 font-medium text-ink-soft hover:text-ink">
            <X size={13} /> Cancel
          </button>
        </div>
      )}

      {status === "error" && (
        <div className="mt-5 rounded-xl border border-line bg-paper px-4 py-3.5">
          <div className="flex items-start gap-2.5 text-[13px] leading-relaxed text-ink">
            <TriangleAlert size={14} className="mt-0.5 shrink-0 text-warning" />
            <div>
              {failure?.error}
              {failure?.detail && <div className="mt-1 break-words font-mono text-[11.5px] text-ink-faint">{failure.detail}</div>}
              <div className="mt-1 text-[12.5px] text-ink-soft">Nothing else on this page depends on it.</div>
            </div>
          </div>
        </div>
      )}

      {status !== "loading" && children}

      <CacheNote />
    </div>
  );
}

/* Where the user gets rid of kept answers. In the shared frame so all three
   features say it once and identically — the count is every stored answer, not
   this panel's. Read on render: the panel re-renders when a request finishes,
   which is the only moment the count moves without a click. */
function CacheNote() {
  const [cleared, setCleared] = useState(0);
  const count = cachedCount();
  if (count === 0) return null;
  return (
    <p className="mt-5 border-t border-line pt-3.5 text-[12px] leading-relaxed text-ink-faint">
      {count} saved answer{count > 1 ? "s" : ""} in this browser.{" "}
      <button
        type="button"
        onClick={() => { clearCache(); setCleared(cleared + 1); }}
        className="font-medium text-ink-soft underline decoration-line-strong underline-offset-2 hover:text-ink"
      >
        Clear
      </button>
    </p>
  );
}

export default AiPanel;
