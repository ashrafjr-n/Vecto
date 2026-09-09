import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

import OverviewTab       from "./tabs/OverviewTab.jsx";
import QualityTab        from "./tabs/QualityTab.jsx";
import StatisticsTab     from "./tabs/StatisticsTab.jsx";
import VisualizationsTab from "./tabs/VisualizationsTab.jsx";
import RelationshipsTab  from "./tabs/RelationshipsTab.jsx";
import ClassBalanceTab   from "./tabs/ClassBalanceTab.jsx";
import TargetSignalTab   from "./tabs/TargetSignalTab.jsx";

const BASE_TABS = [
  { id: "overview",       label: "Overview"                            },
  { id: "quality",        label: "Quality"                             },
  { id: "statistics",     label: "Statistics"                          },
  { id: "visualizations", label: "Visualizations"                      },
  { id: "targetsignal",   label: "Target Signal", requiresTarget: true },
  { id: "relationships",  label: "Relationships"                       },
  { id: "classbalance",   label: "Class Balance", requiresTarget: true },
];

function ResultsDashboard({ result, onReset }) {
  const [activeTab, setActiveTab] = useState("overview");

  if (!result) return null;

  const { meta, quality, healthScore } = result;
  const tabs = BASE_TABS.filter((t) => !t.requiresTarget || !!meta.target);
  const healthTone = healthScore
    ? healthScore.score >= 80 ? "success" : healthScore.score >= 60 ? "warning" : "critical"
    : "ink";

  const stats = [
    { label: "Rows",           value: meta.rows.toLocaleString() },
    { label: "Columns",        value: meta.columns },
    {
      label: "Missing cells",
      value: quality.missingCells.toLocaleString(),
      tone:  quality.missingCells > 0 ? "warning" : "success",
    },
    {
      label: "Duplicate rows",
      value: quality.duplicatesComputed ? quality.duplicateRows.toLocaleString() : "Skipped",
      tone:  !quality.duplicatesComputed ? "ink" : quality.duplicateRows > 0 ? "warning" : "success",
    },
    { label: "Quality score", value: quality.qualityScore, suffix: "/100" },
    {
      label:  "Health score",
      value:  healthScore?.score ?? quality.qualityScore,
      suffix: "/100",
      tone:   healthTone,
    },
  ];

  const toneCls = {
    ink:      "text-ink",
    success:  "text-success",
    warning:  "text-warning",
    critical: "text-critical",
  };

  return (
    <div className="mx-auto max-w-[1400px] px-6 pb-16 pt-8 sm:px-12">

      {/* Sidebar + content */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">

        <div className="flex flex-col items-center gap-3 lg:sticky lg:top-20 lg:w-[240px] lg:shrink-0">

          <aside className="w-full overflow-hidden rounded-xl border border-line bg-paper">

            {/* Scope */}
            <div className="border-b border-line px-4 py-4">
              <div className="text-[11px] uppercase tracking-wide text-ink-faint">Scope</div>
              <div className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">
                {meta.target ? (
                  <>Target <span className="font-mono font-medium text-ink">{meta.target}</span> · {meta.datasetType}</>
                ) : (
                  "No target selected · Exploratory analysis"
                )}
              </div>
            </div>

            {/* KPI stats */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.32 }}
              className="divide-y divide-line border-b border-line"
            >
              {stats.map((s) => (
                <div key={s.label} className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-[12.5px] text-ink-faint">{s.label}</span>
                  <span className={`font-mono text-[13px] font-semibold ${toneCls[s.tone] ?? "text-ink"}`}>
                    {s.value}
                    {s.suffix && <span className="ml-0.5 text-[11px] font-normal text-ink-faint">{s.suffix}</span>}
                  </span>
                </div>
              ))}
            </motion.div>

            {/* Tab nav */}
            <nav className="flex flex-col gap-0.5 p-2">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`whitespace-nowrap rounded-md px-3.5 py-2.5 text-left text-[13px] font-medium transition-colors ${
                    activeTab === tab.id
                      ? "bg-gold-tint text-gold-ink"
                      : "text-ink-soft hover:bg-paper-sunken hover:text-ink"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>

          </aside>

          <button
            type="button"
            onClick={onReset}
            className="inline-flex w-1/2 items-center justify-center whitespace-nowrap rounded-md border border-line px-3 py-2 text-[12.5px] font-medium text-ink-soft transition-colors hover:bg-paper-sunken hover:text-ink"
          >
            New analysis
          </button>

        </div>

        <div className="min-w-0 flex-1">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
            >
              {activeTab === "overview"       && <OverviewTab       result={result} />}
              {activeTab === "quality"        && <QualityTab        result={result} />}
              {activeTab === "statistics"     && <StatisticsTab     result={result} />}
              {activeTab === "visualizations" && <VisualizationsTab result={result} />}
              {activeTab === "targetsignal"   && <TargetSignalTab   result={result} />}
              {activeTab === "relationships"  && <RelationshipsTab  result={result} />}
              {activeTab === "classbalance"   && <ClassBalanceTab   result={result} />}
            </motion.div>
          </AnimatePresence>
        </div>

      </div>

    </div>
  );
}

export default ResultsDashboard;
