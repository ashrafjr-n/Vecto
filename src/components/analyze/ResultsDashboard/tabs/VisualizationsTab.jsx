import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Info } from "lucide-react";

import SectionCard from "../../shared/SectionCard.jsx";

function InsightBanner({ text }) {
  if (!text) return null;
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-gold/25 bg-gold-tint px-4 py-3 text-[12.5px] leading-relaxed text-ink-soft">
      <Info size={14} className="mt-0.5 shrink-0 text-gold-ink" />
      {text}
    </div>
  );
}

/* ─────────────────────────────────────────────
   BOXPLOT — hand-rolled SVG, single neutral series (no legend needed).
   Mark specs: 2px whisker/median lines, IQR box a neutral tint fill, outliers
   called out below (never plotted as unlabeled dots at this scale).
───────────────────────────────────────────── */
function FlatLine({ value }) {
  return (
    <div className="py-3 text-center">
      <div className="relative h-1 rounded-full bg-paper">
        <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold" />
      </div>
      <div className="mt-3 text-[11px] text-ink-faint">
        No variance — all values equal <span className="font-mono font-medium text-ink">{value?.toLocaleString()}</span>
      </div>
    </div>
  );
}

function BoxPlot({ boxplot }) {
  const { min, max, q1, q3, median, mean, lowerFence, upperFence, outlierCount } = boxplot;
  if (max === min) return <FlatLine value={min} />;

  const range = max - min;
  const toX = (v) => Math.round(((v - min) / range) * 100);
  const fL = toX(Math.max(min, lowerFence));
  const fR = toX(Math.min(max, upperFence));
  const q1x = toX(q1), q3x = toX(q3), medX = toX(median);
  const meanX = mean != null ? toX(mean) : null;

  return (
    <div>
      <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="h-14 w-full overflow-visible">
        <line x1={fL} y1="14" x2={fR} y2="14" stroke="var(--color-line-strong)" strokeWidth="0.8" />
        <line x1={fL} y1="9" x2={fL} y2="19" stroke="var(--color-ink-faint)" strokeWidth="0.8" />
        <line x1={fR} y1="9" x2={fR} y2="19" stroke="var(--color-ink-faint)" strokeWidth="0.8" />
        <rect x={q1x} y="7" width={q3x - q1x} height="14" fill="var(--color-paper)" stroke="var(--color-ink-soft)" strokeWidth="0.8" rx="1" />
        <line x1={medX} y1="7" x2={medX} y2="21" stroke="var(--color-ink)" strokeWidth="1.4" />
        {meanX != null && (
          <polygon
            points={`${meanX},5 ${meanX + 2},14 ${meanX},23 ${meanX - 2},14`}
            fill="var(--color-gold)"
          />
        )}
      </svg>

      <div className="mt-1 flex flex-wrap justify-between gap-1 font-mono text-[10px] text-ink-faint">
        <span>{min.toLocaleString()}</span>
        <span>Q1 {q1.toLocaleString()}</span>
        <span className="font-medium text-ink">Median {median.toLocaleString()}</span>
        {mean != null && <span>Mean {mean.toLocaleString()}</span>}
        <span>Q3 {q3.toLocaleString()}</span>
        <span>{max.toLocaleString()}</span>
      </div>

      {outlierCount > 0 && (
        <div className="mt-2.5 inline-block rounded-md bg-warning-tint px-3 py-1.5 text-[11px] text-warning">
          {outlierCount} outlier{outlierCount > 1 ? "s" : ""} detected beyond fences
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   NUMERIC — histogram (single neutral hue; magnitude already reads via bar
   height, so a per-bar gradient would be redundant) + boxplot.
───────────────────────────────────────────── */
function NumericView({ vis }) {
  if (!vis?.histogram?.length) return null;
  const maxCount = vis.histogram.reduce((m, b) => Math.max(m, b.count), 1);

  return (
    <div className="space-y-3">
      <SectionCard title="Distribution">
        <div className="flex h-36 items-end gap-[3px]">
          {vis.histogram.map((b, i) => {
            const heightPct = (b.count / maxCount) * 100;
            const isMax = b.count === maxCount;
            return (
              <div key={b.bin} title={`${b.bin}: ${b.count.toLocaleString()}`} className="flex h-full flex-1 flex-col items-center justify-end">
                <span className={`mb-1 whitespace-nowrap font-mono text-[9px] ${isMax ? "text-gold-ink" : "invisible"}`}>
                  {b.count.toLocaleString()}
                </span>
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: `${heightPct}%` }}
                  transition={{ delay: i * 0.02, duration: 0.4, ease: "easeOut" }}
                  className={`w-full rounded-t-sm ${isMax ? "bg-gold" : "bg-ink-faint/50"}`}
                  style={{ minHeight: b.count > 0 ? "3px" : 0 }}
                />
              </div>
            );
          })}
        </div>
        <div className="mt-1.5 flex gap-[3px]">
          {vis.histogram.map((b) => (
            <div key={b.bin} className="flex-1 truncate text-center font-mono text-[9px] text-ink-faint">
              {b.bin.split("–")[0]}
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Spread & outliers">
        <BoxPlot boxplot={vis.boxplot} />
      </SectionCard>

      <InsightBanner text={vis.insight} />
    </div>
  );
}

/* ─────────────────────────────────────────────
   CATEGORICAL — emphasis form: top category in gold, the rest in neutral ink,
   never a rainbow of hues for what is really one highlighted bar + context.
───────────────────────────────────────────── */
function CategoricalView({ vis }) {
  const [hovered, setHovered] = useState(null);
  const data = vis?.data;

  const totalCount = useMemo(() => (data ?? []).reduce((s, d) => s + d.count, 0) || 1, [data]);
  const rankMap = useMemo(() => {
    const sorted = [...(data ?? [])].sort((a, b) => b.count - a.count);
    return Object.fromEntries(sorted.map((d, i) => [d.value, i + 1]));
  }, [data]);

  if (!data?.length) return null;
  const totalCategories = data.length;

  return (
    <div className="space-y-3">
      <SectionCard
        title="Category distribution"
        action={<span className="text-[11px] text-ink-faint">Bar length = share of total · hover for rank</span>}
      >
        <div className="space-y-2.5">
          {data.map((item, i) => {
            const pct = Math.min(100, Math.max(0, (item.count / totalCount) * 100));
            const isTop = rankMap[item.value] === 1;
            const isHovered = hovered === item.value;

            return (
              <div key={item.value} onMouseEnter={() => setHovered(item.value)} onMouseLeave={() => setHovered(null)}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={`truncate text-[12.5px] ${isHovered ? "text-ink" : "text-ink-soft"}`}>{item.value}</span>
                    {isHovered && (
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${isTop ? "bg-gold-tint text-gold-ink" : "bg-paper text-ink-faint"}`}>
                        #{rankMap[item.value]} of {totalCategories}
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2.5">
                    {isHovered && <span className="font-mono text-[11px] text-ink-faint">{item.count.toLocaleString()}</span>}
                    <span className={`w-11 text-right font-mono text-[12px] font-medium ${isTop ? "text-gold-ink" : "text-ink-soft"}`}>
                      {Math.round(pct * 10) / 10}%
                    </span>
                  </div>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-paper">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ delay: i * 0.03, duration: 0.4, ease: "easeOut" }}
                    className={`h-full rounded-full ${isTop ? "bg-gold" : "bg-ink-faint/60"}`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>

      <InsightBanner text={vis.insight} />
    </div>
  );
}

/* ─────────────────────────────────────────────
   MAIN TAB
───────────────────────────────────────────── */
function VisualizationsTab({ result }) {
  const { visualizations } = result;
  const [selected, setSelected] = useState("");

  const { numericVis, categoricalVis, vis, activeCol } = useMemo(() => {
    const active = visualizations.some((v) => v.col === selected) ? selected : (visualizations[0]?.col ?? "");
    return {
      numericVis: visualizations.filter((v) => v.type === "numeric"),
      categoricalVis: visualizations.filter((v) => v.type === "categorical"),
      vis: visualizations.find((v) => v.col === active) ?? null,
      activeCol: active,
    };
  }, [visualizations, selected]);

  if (!visualizations.length) {
    return (
      <SectionCard>
        <div className="py-8 text-center text-[13px] text-ink-faint">No columns available for visualization.</div>
      </SectionCard>
    );
  }

  return (
    <div>
      <div className="mb-5 space-y-3">
        {numericVis.length > 0 && (
          <div>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">Numeric ({numericVis.length})</div>
            <div className="flex flex-wrap gap-1.5">
              {numericVis.map((v) => (
                <button
                  key={v.col}
                  type="button"
                  onClick={() => setSelected(v.col)}
                  className={`rounded-md px-3 py-1.5 font-mono text-[12px] transition-colors ${
                    activeCol === v.col ? "bg-gold-tint font-medium text-gold-ink" : "bg-paper text-ink-soft hover:text-ink"
                  }`}
                >
                  {v.col}
                </button>
              ))}
            </div>
          </div>
        )}
        {categoricalVis.length > 0 && (
          <div>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">Categorical ({categoricalVis.length})</div>
            <div className="flex flex-wrap gap-1.5">
              {categoricalVis.map((v) => (
                <button
                  key={v.col}
                  type="button"
                  onClick={() => setSelected(v.col)}
                  className={`rounded-md px-3 py-1.5 font-mono text-[12px] transition-colors ${
                    activeCol === v.col ? "bg-info-tint font-medium text-info" : "bg-paper text-ink-soft hover:text-ink"
                  }`}
                >
                  {v.col}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {vis && (
        <motion.div key={activeCol} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
          {vis.type === "numeric" && <NumericView vis={vis} />}
          {vis.type === "categorical" && <CategoricalView vis={vis} />}
        </motion.div>
      )}
    </div>
  );
}

export default VisualizationsTab;
