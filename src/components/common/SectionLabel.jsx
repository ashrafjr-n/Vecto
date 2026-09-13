/* Mono index + label above every editorial block — the section marker doing the
   work an icon or a card border would do in a denser layout. Shared by Home and
   Methodology so the two editorial pages can't mark sections differently. */
function SectionLabel({ mark, children }) {
  return (
    <div className="flex items-baseline gap-4 font-mono text-[11px] uppercase tracking-[0.22em] text-ink-faint">
      <span>{mark}</span>
      <span className="h-px flex-1 bg-line" />
      <span>{children}</span>
    </div>
  );
}

export default SectionLabel;
