import { useState } from "react";
import { motion } from "framer-motion";

import SectionCard from "../../shared/SectionCard.jsx";

function StatisticsTab({ result }) {
  const { statistics } = result;
  const [selected, setSelected] = useState(statistics[0]?.col || "");
  const stat = statistics.find((s) => s.col === selected);

  if (!statistics.length) {
    return (
      <SectionCard>
        <div className="py-8 text-center text-[13px] text-ink-faint">No numeric columns found.</div>
      </SectionCard>
    );
  }

  const rows = stat && !stat.empty ? [
    { label: "Mean",          value: stat.mean },
    { label: "Median",        value: stat.median },
    { label: "Minimum",       value: stat.min },
    { label: "Maximum",       value: stat.max },
    { label: "Std deviation", value: stat.std },
    { label: "Q1 (25%)",      value: stat.q1 },
    { label: "Q3 (75%)",      value: stat.q3 },
    { label: "IQR",           value: stat.iqr },
    { label: "Skewness",      value: `${stat.skewness} (${stat.skewnessLabel})` },
    { label: "Kurtosis",      value: stat.kurtosis },
    { label: "Outliers",      value: stat.outlierCount },
    { label: "Count",         value: stat.count },
  ] : [];

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-1.5">
        {statistics.map((s) => (
          <button
            key={s.col}
            type="button"
            onClick={() => setSelected(s.col)}
            className={`rounded-md px-3 py-1.5 font-mono text-[12px] transition-colors ${
              selected === s.col
                ? "bg-accent-tint font-medium text-accent-ink"
                : "bg-paper text-ink-soft hover:text-ink"
            }`}
          >
            {s.col}
          </button>
        ))}
      </div>

      {stat && !stat.empty ? (
        <motion.div key={selected} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
          <SectionCard title={selected}>
            <div className="grid grid-cols-2 gap-x-8 gap-y-2.5 sm:grid-cols-3">
              {rows.map((row) => (
                <div key={row.label} className="flex items-center justify-between border-b border-line pb-2">
                  <span className="text-[12px] text-ink-soft">{row.label}</span>
                  <span className="font-mono text-[12.5px] font-medium text-ink">
                    {typeof row.value === "number" ? row.value.toLocaleString() : row.value}
                  </span>
                </div>
              ))}
            </div>
          </SectionCard>
        </motion.div>
      ) : (
        <SectionCard>
          <div className="py-8 text-center text-[13px] text-ink-faint">No data available for this column.</div>
        </SectionCard>
      )}
    </div>
  );
}

export default StatisticsTab;
