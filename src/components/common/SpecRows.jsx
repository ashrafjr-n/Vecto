/* The repeating unit of both reference pages: a label/definition ledger set as
   two columns, so a rule reads as a line in a datasheet rather than as another
   card. Rows are `{ label, text }`. */
function SpecRows({ rows, className = "" }) {
  return (
    <dl className={`border-t border-line ${className}`}>
      {rows.map((row) => (
        <div
          key={row.label}
          className="grid gap-x-10 gap-y-1.5 border-b border-line py-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]"
        >
          <dt className="text-[14px] font-medium tracking-tight text-ink">{row.label}</dt>
          <dd className="max-w-3xl text-[13.5px] leading-[1.75] text-ink-soft">{row.text}</dd>
        </div>
      ))}
    </dl>
  );
}

export default SpecRows;
