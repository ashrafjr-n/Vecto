/* Label + hairline above every editorial block — the section marker doing the
   work an icon or a card border would do in a denser layout. Shared by Home and
   Methodology so the two editorial pages can't mark sections differently.
   Plain sentence case: the old mono index + tracked capitals read as a template. */
function SectionLabel({ children }) {
  return (
    <div className="flex items-center gap-4 text-[13px] font-medium text-ink-faint">
      <span>{children}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

export default SectionLabel;
