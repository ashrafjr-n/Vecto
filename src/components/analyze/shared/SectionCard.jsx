/* The report's one repeating surface: the lifted panel token, a hairline border,
   and a plain title with a rule running to the action.

   `p-5` is load-bearing, not a taste choice: DatasetSnapshot bleeds its table to
   the panel edge with `-mx-5` and OverviewTab's sibling panels align to it. Don't
   change it to `p-6` without fixing the bleed. */
function SectionCard({ title, action, children, className = "" }) {
  return (
    <div className={`rounded-2xl border border-line bg-paper-sunken p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          {title && <h3 className="text-[14px] font-semibold tracking-tight text-ink">{title}</h3>}
          <span className="h-px min-w-4 flex-1 bg-line" />
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export default SectionCard;
