/* The report's one repeating surface. Editorial panel, not a card: large radius,
   the lifted panel token, and a mono section marker with a hairline rule running
   to the action — the same `SectionLabel` grammar Home uses, so the report and
   the front page read as one publication.

   `p-5` is load-bearing, not a taste choice: DatasetSnapshot bleeds its table to
   the panel edge with `-mx-5` and OverviewTab's sibling panels align to it. Don't
   change it to `p-6` without fixing the bleed. */
function SectionCard({ title, action, children, className = "" }) {
  return (
    <div className={`rounded-[1.75rem] border border-line bg-paper-sunken p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-5 flex items-baseline gap-4">
          {title && (
            <h3 className="shrink-0 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint">{title}</h3>
          )}
          <span className="h-px min-w-4 flex-1 bg-line" />
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export default SectionCard;
