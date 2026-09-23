import { Fragment, useState } from "react";
import { ChevronDown } from "lucide-react";

import SectionCard from "../../shared/SectionCard.jsx";

/* Every numeric column at once, not one at a time.

   This tab used to be a row of pills with a single column's card under it: on a
   15-column file that is four pills and twelve numbers in a screen of nothing,
   and comparing two columns meant clicking between them and remembering. A table
   is what the data is — one row per column, the figures that fit a scan in the
   columns, and the rest of each column's statistics one click away on its own row,
   so nothing scrolls out from under the reader.

   `n` is deliberately not called "missing": it is how many values the column
   actually provides, and the rest of the rows are missing OR non-numeric in a
   column kept numeric (which Quality reports as `mixed_numeric`, with counts).
   Subtracting it from the row count and calling the difference "missing" would
   merge two different facts. */

const num = (v) => (typeof v === "number" ? v.toLocaleString() : v ?? "—");

// The scan: what a reader compares across columns.
const COLUMNS = [
  { key: "count",        label: "n"        },
  { key: "mean",         label: "Mean"     },
  { key: "median",       label: "Median"   },
  { key: "std",          label: "Std"      },
  { key: "min",          label: "Min"      },
  { key: "max",          label: "Max"      },
  { key: "outlierCount", label: "Outliers" },
];

// The rest, shown for one column when its row is opened.
const detailRows = (s) => [
  { label: "Q1 (25%)",  value: s.q1 },
  { label: "Q3 (75%)",  value: s.q3 },
  { label: "IQR",       value: s.iqr },
  { label: "Skewness",  value: `${s.skewness} (${s.skewnessLabel})` },
  { label: "Kurtosis",  value: s.kurtosis },
  { label: "Medcouple", value: s.medcouple },
  { label: "Lower fence", value: s.lowerFence },
  { label: "Upper fence", value: s.upperFence },
];

function StatisticsTab({ result }) {
  const { statistics, meta } = result;
  const [open, setOpen] = useState(null);

  if (!statistics.length) {
    return (
      <SectionCard>
        <div className="py-8 text-center text-[13px] text-ink-faint">No numeric columns found.</div>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title={`Numeric columns — ${statistics.length}`}
      action={<span className="font-mono text-[11px] text-ink-faint">n of {meta.rows.toLocaleString()} rows</span>}
    >
      <p className="mb-4 text-[12.5px] leading-relaxed text-ink-soft">
        <span className="font-mono text-ink">n</span> is how many values the column provides;
        the remaining rows are missing, or non-numeric in a column kept numeric — the Quality
        tab names them. Open a row for its quartiles, shape and outlier fences.
      </p>

      {/* A real table: one <td> per figure, so the header and the values are laid
          out by the same thing. An earlier pass put a CSS grid inside a colSpan
          cell and the columns silently drifted one place from their headings —
          caught by looking at it, which is the only way that one shows up. */}
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[680px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="py-2 pr-4 text-[11.5px] font-medium text-ink-faint">Column</th>
              {COLUMNS.map((c) => (
                <th key={c.key} scope="col" className="py-2 pl-4 text-right text-[11.5px] font-medium text-ink-faint">
                  {c.label}
                </th>
              ))}
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {statistics.map((s) => {
              const isOpen = open === s.col;
              const toggle = () => { if (!s.empty) setOpen(isOpen ? null : s.col); };
              return (
                <Fragment key={s.col}>
                  <tr
                    onClick={toggle}
                    className={`border-b border-line ${s.empty ? "" : "cursor-pointer hover:bg-paper"} ${isOpen ? "bg-paper" : ""}`}
                  >
                    <th scope="row" className="max-w-[220px] truncate py-2.5 pr-4 font-mono text-[12.5px] font-normal text-ink">
                      {s.col}
                    </th>
                    {s.empty
                      ? <td colSpan={COLUMNS.length} className="py-2.5 pl-4 text-right text-[12px] text-ink-faint">no numeric values</td>
                      : COLUMNS.map((c) => (
                          <td
                            key={c.key}
                            className={`py-2.5 pl-4 text-right font-mono text-[12.5px] ${
                              c.key === "outlierCount" && s.outlierCount > 0 ? "text-warning" : "text-ink-soft"
                            }`}
                          >
                            {num(s[c.key])}
                          </td>
                        ))}
                    <td className="py-2.5 pl-2">
                      {!s.empty && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); toggle(); }}
                          aria-expanded={isOpen}
                          aria-label={`${isOpen ? "Hide" : "Show"} the rest of ${s.col}`}
                          className="block rounded-md p-1 text-ink-faint transition-colors hover:text-ink"
                        >
                          <ChevronDown size={14} className={`transition-transform ${isOpen ? "rotate-180" : ""}`} />
                        </button>
                      )}
                    </td>
                  </tr>

                  {isOpen && !s.empty && (
                    <tr className="border-b border-line bg-paper">
                      <td colSpan={COLUMNS.length + 2} className="px-1 py-3">
                        <div className="grid grid-cols-2 gap-x-8 gap-y-2 sm:grid-cols-4">
                          {detailRows(s).map((row) => (
                            <div key={row.label} className="flex items-baseline justify-between gap-3">
                              <span className="text-[12px] text-ink-soft">{row.label}</span>
                              <span className="font-mono text-[12.5px] text-ink">{num(row.value)}</span>
                            </div>
                          ))}
                          {s.isConstant && (
                            <p className="col-span-2 text-[12px] text-ink-faint sm:col-span-4">
                              Every value is the same — this column carries no information for a model.
                            </p>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

export default StatisticsTab;
