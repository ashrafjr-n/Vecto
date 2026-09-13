import { Sparkles } from "lucide-react";

/* The one label for anything a language model produced. Shared by the target
   picker (the suggestion itself) and the report (a role the user accepted), so an
   AI-derived item looks the same wherever it appears and can never be mistaken
   for an engine measurement.

   No colour of its own: the status colours are reserved for severity and the
   brand is monochrome. The dashed border is the mark — nothing the engine
   computes is drawn with one — plus the icon and the words. */
function AiBadge({ children = "AI suggestion", title }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line-strong bg-accent-tint px-2.5 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide text-accent-ink"
    >
      <Sparkles size={11} className="shrink-0" />
      {children}
    </span>
  );
}

export default AiBadge;
