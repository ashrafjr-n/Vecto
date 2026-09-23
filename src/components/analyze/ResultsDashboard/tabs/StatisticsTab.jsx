import { useState } from "react";
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

      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line">
              <th className="py-2 pr-4 text-[11.5px] font-medium text-ink-faint">Column</th>
              {COLUMNS.map((c) => (
                <th key={c.key} className="py-2 pl-4 text-right text-[11.5px] font-medium text-ink-faint">
                  {c.label}
                </th>
              ))}
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {statistics.map((s) => {
              const isOpen = open === s.col;
              return (
                <tr key={s.col} className="border-b border-line align-top">
                  <td colSpan={COLUMNS.length + 2} className="p-0">
                    <button
                      type="button"
                      onClick={() => setOpen(isOpen ? null : s.col)}
                      disabled={s.empty}
                      aria-expanded={isOpen}
                      className={`grid w-full grid-cols-[minmax(0,1fr)_repeat(7,minmax(56px,auto))_28px] items-center gap-x-4 py-2.5 text-left transition-colors ${
                        s.empty ? "cursor-default" : "hover:bg-paper"
                      } ${isOpen ? "bg-paper" : ""}`}
                    >
                      <span className="truncate font-mono text-[12.5px] text-ink">{s.col}</span>
                      {s.empty
                        ? <span className="col-span-7 text-right text-[12px] text-ink-faint">no numeric values</span>
                        : COLUMNS.map((c) => (
                            <span
                              key={c.key}
                              className={`text-right font-mono text-[12.5px] ${
                                c.key === "outlierCount" && s.outlierCount > 0 ? "text-warning" : "text-ink-soft"
                              }`}
                            >
                              {num(s[c.key])}
                            </span>
                          ))}
                      <ChevronDown
                        size={14}
                        className={`justify-self-end text-ink-faint transition-transform ${isOpen ? "rotate-180" : ""} ${s.empty ? "opacity-0" : ""}`}
                      />
                    </button>

                    {isOpen && !s.empty && (
                      <div className="grid grid-cols-2 gap-x-8 gap-y-2 border-t border-line bg-paper px-1 py-3 sm:grid-cols-4">
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
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

export default StatisticsTab;
