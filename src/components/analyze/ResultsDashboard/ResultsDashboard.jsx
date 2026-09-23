import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SlidersHorizontal } from "lucide-react";

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

function ResultsDashboard({ result, onReset, onChangeTarget, ai }) {
  const [activeTab, setActiveTab] = useState("overview");

  if (!result) return null;

  const { meta, quality, healthScore } = result;
  // classBalance is null for a regression target — there are no classes to show.
  const tabs = BASE_TABS.filter((t) => (!t.requiresTarget || !!meta.target)
                                    && (!t.requiresClasses || !!result.classBalance));
  // A constant or identifier target: there is no task, and several sections say so.
  const unusableTarget = Boolean(meta.target) && (meta.targetIsConstant || meta.targetIsIdentifier);
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
    <div className="mx-auto max-w-[1400px] px-6 pb-24 sm:px-10">

      {/* ── THE CONTROL BAR — pinned under the site header, at every width.

          Everything that says WHICH report this is (the target, the six figures
          that have no section of their own) and everything that moves around it
          (the section list, Change target, New analysis) stays on screen at every
          scroll position. A dense report is read by comparing a number in one
          section against a number in another, and a header that scrolls away
          makes the reader hold the target and the row count in their head.

          One bar at all widths, and one section list inside it — the tabs used to
          be a vertical rail on `lg` and a scrolling row below it, which was two
          layouts and two sets of classes for one control. The content is full
          width now, which is what a table of forty columns actually wants. ── */}
      <div className="sticky top-16 z-30 -mx-6 border-b border-line bg-paper/90 px-6 backdrop-blur sm:-mx-10 sm:px-10">

        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 pt-3 sm:pt-5">
          <div className="min-w-0">
            <p className="hidden text-[11.5px] uppercase tracking-[0.08em] text-ink-faint sm:block">Dataset report</p>
            <div className="flex items-baseline gap-3">
              <h1 className="truncate sm:mt-1 text-[1.25rem] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[1.5rem]">
                {meta.target ? <>Target: <span className="break-all font-mono text-accent-ink">{meta.target}</span></> : "No target — exploratory report"}
              </h1>
              {/* The task type is a fact about the whole report, so it belongs beside
                  the target rather than in a sentence repeated above all eight tabs. */}
              {meta.target && !unusableTarget && (
                <span className="hidden shrink-0 rounded-md bg-accent-tint px-2 py-0.5 text-[11.5px] text-ink-soft sm:inline">
                  {meta.datasetType}
                </span>
              )}
            </div>
          </div>
          {/* The target is chosen by the engine when a file is dropped, so the choice
              has to stay visible and reversible from the report itself — otherwise a
              guessed target would be a decision made silently on the user's behalf.
              It is a button beside New analysis, not an underlined word: the two are
              the report's two actions and reading as one pair is the honest shape. */}
          <div className="flex shrink-0 items-center gap-2">
            {onChangeTarget && (
              <button
                type="button"
                onClick={onChangeTarget}
                className="inline-flex items-center gap-1.5 rounded-xl border border-line-strong px-3.5 py-2 text-[12.5px] font-medium text-ink transition-colors hover:bg-accent-tint"
              >
                <SlidersHorizontal size={13} className="shrink-0" />
                {meta.target ? "Change target" : "Choose a target"}
              </button>
            )}
            <button
              type="button"
              onClick={onReset}
              className="inline-flex items-center rounded-xl border border-line px-3.5 py-2 text-[12.5px] font-medium text-ink-soft transition-colors hover:border-ink-faint hover:text-ink"
            >
              New analysis
            </button>
          </div>
        </div>

        {/* The six figures, one strip. They scroll sideways rather than wrapping,
            so the bar's height is the same at 390px as at 1440 and the content
            below it keeps the screen. */}
        <dl className="mt-3 flex gap-px sm:mt-4 overflow-x-auto rounded-xl border border-line bg-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {stats.map((s) => (
            <div key={s.label} className="min-w-[112px] flex-1 bg-paper-sunken px-3.5 py-2 sm:py-2.5">
              <dt className="whitespace-nowrap text-[11px] text-ink-faint">{s.label}</dt>
              <dd className={`mt-0.5 font-mono text-[1.0625rem] font-medium leading-tight tracking-tight ${toneCls[s.tone] ?? "text-ink"}`}>
                {s.value}
                {s.suffix && <span className="text-[11px] font-normal text-ink-faint">{s.suffix}</span>}
              </dd>
            </div>
          ))}
        </dl>

        <nav
          aria-label="Report sections"
          className="mt-1.5 flex gap-1 overflow-x-auto sm:mt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                aria-current={isActive ? "page" : undefined}
                onClick={() => setActiveTab(tab.id)}
                className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-[13.5px] sm:py-2.5 transition-colors ${
                  isActive
                    ? "border-accent-ink font-medium text-ink"
                    : "border-transparent text-ink-soft hover:text-ink"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* A defect in the target is a problem with the whole report, so it is stated
          on every section. The descriptive sentence is not: it said the same thing
          above all eight tabs, which is how a sentence stops being read. */}
      {unusableTarget && (
        <p className="mt-6 max-w-3xl text-[14px] leading-relaxed text-warning">
          No task type can be read: <span className="font-mono">{meta.target}</span> {meta.targetIsConstant ? "has the same value on every row" : "is unique per row — an identifier, not a label"}. Pick a different target; the sections below describe the data, not a model problem.
        </p>
      )}
      {!unusableTarget && activeTab === "overview" && (
        <p className="mt-6 max-w-3xl text-[14px] leading-relaxed text-ink-soft">
          {meta.target
            ? <>{meta.datasetType} task. Every figure in this report is computed in your browser and comes with the reasoning behind it.</>
            : <>Class balance, target signal and preparation need a target and are omitted. Every other section is computed normally.</>}
        </p>
      )}
      {/* Provenance: a report built from cleaned rows must say so where the report starts. */}
      {ai?.cleaningRules?.length > 0 && (
        <p className="mt-3 flex max-w-3xl flex-wrap items-center gap-2 text-[13px] text-ink-soft">
          <AiBadge>set by you</AiBadge>
          Built after {ai.cleaningRules.length} cleaning rule{ai.cleaningRules.length > 1 ? "s" : ""} you accepted — listed on the Quality tab.
        </p>
      )}

      <div className="mt-6">
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
  );
}

export default ResultsDashboard;
