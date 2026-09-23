import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

import OverviewTab       from "./tabs/OverviewTab.jsx";
import QualityTab        from "./tabs/QualityTab.jsx";
import StatisticsTab     from "./tabs/StatisticsTab.jsx";
import VisualizationsTab from "./tabs/VisualizationsTab.jsx";
import RelationshipsTab  from "./tabs/RelationshipsTab.jsx";
import ClassBalanceTab   from "./tabs/ClassBalanceTab.jsx";
import TargetSignalTab   from "./tabs/TargetSignalTab.jsx";
import PreparationTab    from "./tabs/PreparationTab.jsx";
import AiBadge           from "../shared/AiBadge.jsx";

const BASE_TABS = [
  { id: "overview",       label: "Overview"                            },
  { id: "quality",        label: "Quality"                             },
  { id: "statistics",     label: "Statistics"                          },
  { id: "visualizations", label: "Visualizations"                      },
  { id: "targetsignal",   label: "Target signal", requiresTarget: true },
  { id: "relationships",  label: "Relationships"                       },
  { id: "classbalance",   label: "Class balance", requiresClasses: true },
  { id: "preparation",    label: "Preparation",   requiresTarget: true },
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
    <div className="mx-auto max-w-[1400px] px-6 pt-10 pb-24 sm:px-10 sm:pt-12">

      {/* ── REPORT HEADER — what was analysed, then the six figures that have no
          section of their own. Compact on purpose: the report is the content. ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[13px] text-ink-faint">Dataset report</p>
          <h1 className="mt-1.5 text-[1.5rem] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-3xl">
            {meta.target ? <>Target: <span className="break-all font-mono text-accent-ink">{meta.target}</span></> : "No target — exploratory report"}
          </h1>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="inline-flex shrink-0 items-center rounded-xl border border-line px-4 py-2 text-[12.5px] font-medium text-ink-soft transition-colors hover:border-ink-faint hover:text-ink"
        >
          New analysis
        </button>
      </div>

      <p className="mt-3 max-w-3xl text-[14px] leading-relaxed text-ink-soft">
        {meta.target && (meta.targetIsConstant || meta.targetIsIdentifier)
          ? <>No task type can be read: <span className="font-mono text-ink">{meta.target}</span> {meta.targetIsConstant ? "has the same value on every row" : "is unique per row — an identifier, not a label"}. Pick a different target; the sections below describe the data, not a model problem.</>
          : meta.target
          ? <>{meta.datasetType} task. Every figure below is computed in this tab and comes with the reasoning behind it.</>
          : <>Class balance, target signal and preparation need a target and are omitted. Every other section is computed normally.</>}
      </p>
      {/* Provenance: a report built from cleaned rows must say so where the report starts. */}
      {ai?.cleaningRules?.length > 0 && (
        <p className="mt-3 flex max-w-3xl flex-wrap items-center gap-2 text-[13px] text-ink-soft">
          <AiBadge>set by you</AiBadge>
          Built after {ai.cleaningRules.length} cleaning rule{ai.cleaningRules.length > 1 ? "s" : ""} you accepted — listed on the Quality tab.
        </p>
      )}

      <motion.dl
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3 lg:grid-cols-6"
      >
        {stats.map((s) => (
          <div key={s.label} className="bg-paper-sunken px-4 py-4">
            <dt className="text-[12px] text-ink-faint">{s.label}</dt>
            <dd className={`mt-1 font-mono text-[1.375rem] font-medium tracking-tight ${toneCls[s.tone] ?? "text-ink"}`}>
              {s.value}
              {s.suffix && <span className="text-[12px] font-normal text-ink-faint">{s.suffix}</span>}
            </dd>
          </div>
        ))}
      </motion.dl>

      {/* ── THE REPORT — tabs beside the content on large screens; above it, as one
          scrollable sticky row, on small ones. ── */}
      <div className="mt-10 flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-10">

        <nav
          aria-label="Report sections"
          className="sticky top-16 z-20 -mx-6 flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden border-b border-line bg-paper/95 px-6 py-2 backdrop-blur sm:-mx-10 sm:px-10 lg:top-24 lg:mx-0 lg:w-[200px] lg:shrink-0 lg:flex-col lg:gap-0 lg:overflow-visible lg:border-b-0 lg:border-t lg:bg-transparent lg:p-0 lg:backdrop-blur-none"
        >
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                aria-current={isActive ? "page" : undefined}
                onClick={() => setActiveTab(tab.id)}
                className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-left text-[13.5px] transition-colors lg:rounded-none lg:border-b lg:border-line lg:px-0 lg:py-3 lg:bg-transparent ${
                  isActive ? "bg-accent-tint font-medium text-ink" : "text-ink-soft hover:text-ink"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
            >
              {activeTab === "overview"       && <OverviewTab       result={result} ai={ai} />}
              {activeTab === "quality"        && <QualityTab        result={result} ai={ai} />}
              {activeTab === "statistics"     && <StatisticsTab     result={result} />}
              {activeTab === "visualizations" && <VisualizationsTab result={result} />}
              {activeTab === "targetsignal"   && <TargetSignalTab   result={result} ai={ai} />}
              {activeTab === "relationships"  && <RelationshipsTab  result={result} ai={ai} />}
              {activeTab === "classbalance"   && <ClassBalanceTab   result={result} />}
              {activeTab === "preparation"    && <PreparationTab    result={result} ai={ai} />}
            </motion.div>
          </AnimatePresence>
        </div>

      </div>
    </div>
  );
}

export default ResultsDashboard;
