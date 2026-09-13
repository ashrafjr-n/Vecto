import { LoaderCircle, TriangleAlert, X } from "lucide-react";
import AiBadge from "./AiBadge.jsx";

/* The frame every AI feature sits in: the dashed border that marks AI output
   (see AiBadge), a header, and the loading and error states — so a slow or failed
   model call looks the same on the target picker and in the report, and always
   says that nothing else depends on it. The feature renders its own idle and
   result content as children. */

// Complete literal class strings, not interpolation — Tailwind cannot see a built name.
const SIZE = {
  page:   "rounded-[2rem] p-6 sm:p-8",       // the target picker's panels
  report: "rounded-[1.75rem] p-5",           // SectionCard's radius and padding
};

function AiPanel({ title, size = "page", status, failure, loadingText, onCancel, className = "", children }) {
  return (
    <div className={`border border-dashed border-line-strong bg-paper-sunken ${SIZE[size]} ${className}`}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint">{title}</h2>
        <span className="h-px min-w-4 flex-1 bg-line" />
        <AiBadge>Optional · not measured</AiBadge>
      </div>

      {status === "loading" && (
        <div className="mt-6 flex flex-wrap items-center gap-3 text-[13px] text-ink-soft">
          <LoaderCircle size={16} className="animate-spin text-accent-ink" />
          {loadingText}
          <button type="button" onClick={onCancel} className="inline-flex items-center gap-1 font-medium text-ink-soft hover:text-ink">
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
              <div className="mt-1 text-[12.5px] text-ink-soft">Nothing else on this page depends on it.</div>
            </div>
          </div>
        </div>
      )}

      {status !== "loading" && children}
    </div>
  );
}

export default AiPanel;
