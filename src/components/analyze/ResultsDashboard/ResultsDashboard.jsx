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
  { id: "classbalance",   label: "Class Balance", requiresClasses: true },
];

function ResultsDashboard({ result, onReset, ai }) {
  const [activeTab, setActiveTab] = useState("overview");

  if (!result) return null;

  const { meta, quality, healthScore } = result;
  // classBalance is null for a regression target — there are no classes to show.
  const tabs = BASE_TABS.filter((t) => (!t.requiresTarget || !!meta.target)
                                    && (!t.requiresClasses || !!result.classBalance));
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
    <>
      {/* ── REPORT HEADER — the editorial hero of this page, same shape as
          Home's and TargetStep's: one large surface curving away at the
          bottom into the dotted canvas that holds the report itself.

          The six figures live here rather than in the sidebar, where they used
          to sit directly above the tab nav. They were the only numbers on the
          page with no section of their own, and repeating them in a rail beside
          a report that states each one again is duplication, not emphasis. ── */}
      <section className="rounded-b-[2.5rem] bg-paper-sunken px-6 pt-14 pb-14 sm:rounded-b-[4.5rem] sm:px-12 sm:pt-20 sm:pb-16 lg:rounded-b-[7rem]">
        <div className="mx-auto max-w-[1400px]">

          <div className="flex items-baseline gap-4 font-mono text-[11px] uppercase tracking-[0.22em] text-ink-faint">
            <span>02</span>
            <span className="h-px flex-1 bg-line" />
            <span>Dataset report</span>
          </div>

          <h1 className="mt-10 max-w-[22ch] text-[2rem] font-semibold leading-[1.06] tracking-[-0.035em] text-ink sm:text-5xl">
            {meta.target ? <>Audited against <span className="font-mono text-accent-ink">{meta.target}</span>.</> : "Exploratory audit, no target."}
          </h1>

          <p className="mt-8 max-w-2xl text-[15px] leading-[1.7] text-ink-soft">
            {meta.target && (meta.targetIsConstant || meta.targetIsIdentifier)
              ? <>No task type can be read: <span className="font-mono text-ink">{meta.target}</span> {meta.targetIsConstant ? "has the same value on every row" : "is unique per row — an identifier, not a label"}. Pick a different target; the sections below describe the data, not a model problem.</>
              : meta.target
              ? <>Task type read as {meta.datasetType}. Every figure below is computed from the file in this tab, and each one is stated with the reasoning that produced it.</>
              : <>Class balance and task type need a target and are omitted. Every other section is computed normally.</>}
          </p>

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32 }}
            className="mt-12 grid grid-cols-2 border-t border-line sm:grid-cols-3 lg:grid-cols-6"
          >
            {stats.map((s) => (
              <div key={s.label} className="border-b border-line py-6 pr-6 lg:border-b-0">
                <div className={`font-mono text-[1.75rem] font-medium tracking-tight sm:text-4xl ${toneCls[s.tone] ?? "text-ink"}`}>
                  {s.value}
                  {s.suffix && <span className="text-sm font-normal text-ink-faint">{s.suffix}</span>}
                </div>
                <div className="mt-3 font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-faint">{s.label}</div>
              </div>
            ))}
          </motion.div>

        </div>
      </section>

      {/* ── THE REPORT — panels on the dotted canvas ── */}
      <div className="mx-auto max-w-[1400px] px-6 pb-24 pt-16 sm:px-12 sm:pt-20">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-10">

          <div className="lg:sticky lg:top-24 lg:w-[220px] lg:shrink-0">
            <nav className="border-t border-line">
              {tabs.map((tab, i) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className="flex w-full items-center gap-4 border-b border-line py-3.5 text-left transition-colors"
                  >
                    <span className={`font-mono text-[10.5px] ${isActive ? "text-accent-ink" : "text-ink-faint"}`}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className={`text-[14px] tracking-tight ${isActive ? "text-ink" : "text-ink-soft"}`}>
                      {tab.label}
                    </span>
                  </button>
                );
              })}
            </nav>

            <button
              type="button"
              onClick={onReset}
              className="mt-8 inline-flex items-center rounded-xl border border-line px-4 py-2.5 text-[12.5px] font-medium text-ink-soft transition-colors hover:border-ink-faint hover:text-ink"
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
                {activeTab === "targetsignal"   && <TargetSignalTab   result={result} ai={ai} />}
                {activeTab === "relationships"  && <RelationshipsTab  result={result} />}
                {activeTab === "classbalance"   && <ClassBalanceTab   result={result} />}
              </motion.div>
            </AnimatePresence>
          </div>

        </div>
      </div>
    </>
  );
}

export default ResultsDashboard;
