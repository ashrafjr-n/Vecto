/* The one label for anything a language model produced. Shared by the target
   picker (the suggestion itself) and the report (a role or rule the user accepted),
   so an AI-derived item looks the same wherever it appears and can never be
   mistaken for an engine measurement.

   Deliberately quiet — a neutral pill that always starts with the word "AI". No
   colour of its own (status colours are reserved for severity), and no sparkle
   icon or dashed frame: the words carry the label. */
function AiBadge({ children = "suggestion", title }) {
  return (
    <span
      title={title}
      className="inline-flex shrink-0 items-center gap-1 rounded-md bg-accent-tint px-1.5 py-0.5 text-[11px] font-medium text-ink-soft"
    >
      <span className="font-semibold text-ink">AI</span>
      {children && <span>· {children}</span>}
    </span>
  );
}

export default AiBadge;
