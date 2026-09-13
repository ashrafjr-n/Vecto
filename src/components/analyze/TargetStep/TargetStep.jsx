import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, ArrowLeft, Info, ChevronDown } from "lucide-react";

import { detectColumnRoles } from "../../utils/core/detectors/roles.js";
import { ROLE }              from "../../utils/core/roles.constants.js";
import RolePill               from "../shared/RolePill.jsx";

const TARGET_MODES = [
  { id: "auto",   label: "Auto Detect"   },
  { id: "select", label: "Select Column" },
  { id: "none",   label: "No Target"     },
];

function ModePanel({ mode, columns, colTypes, selected, setSelected, initialTarget }) {
  if (mode === "auto") {
    if (!initialTarget) return null;
    const type = colTypes[initialTarget] ?? ROLE.CATEGORICAL;
    return (
      /* Nested surfaces recess INWARD here: the enclosing panel is
         `paper-sunken` (the lifted token), so a box inside it takes `paper`.
         Reusing `paper-sunken` would make it vanish into its own container. */
      <div className="flex items-center justify-between rounded-xl border border-line bg-paper px-4 py-3.5">
        <span className="font-mono text-[13px] text-ink">{initialTarget}</span>
        <div className="flex items-center gap-2">
          <RolePill role={type} />
          <span className="text-[11px] text-ink-faint">auto-detected</span>
        </div>
      </div>
    );
  }

  if (mode === "select") {
    const type = colTypes[selected] ?? ROLE.CATEGORICAL;
    return (
      <div className="space-y-3">
        <div className="relative">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="w-full appearance-none rounded-xl border border-line-strong bg-paper px-4 py-3 font-mono text-[13px] text-ink focus:border-accent focus:outline-none"
          >
            {columns.map((col) => (
              <option key={col} value={col}>{col} — {colTypes[col]}</option>
            ))}
          </select>
          <ChevronDown size={14} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-ink-faint" />
        </div>
        <div className="flex items-center justify-between rounded-xl border border-line bg-paper px-4 py-3.5">
          <span className="font-mono text-[13px] text-ink">{selected}</span>
          <RolePill role={type} />
        </div>
      </div>
    );
  }

  if (mode === "none") {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-line bg-paper px-4 py-3.5 text-[12.5px] leading-relaxed text-ink-soft">
        <Info size={14} className="mt-0.5 shrink-0 text-ink-faint" />
        Class balance and ML task type will be unavailable without a target
        column. Every other section of the report runs normally.
      </div>
    );
  }

  return null;
}

function TargetStep({ columns, csvData, initialTarget, onConfirm, onBack }) {
  const [mode,     setMode]     = useState("auto");
  const [selected, setSelected] = useState(initialTarget || columns[0] || "");

  // Single source of truth: the same role detector the analyzer runs. Passing a null
  // target keeps every column's natural role — so an ID column is still surfaced as
  // "identifier" here, which is exactly the warning a user needs while picking.
  const colTypes = useMemo(
    () => detectColumnRoles(csvData ?? [], columns, null),
    [columns, csvData],
  );

  const effectiveTarget =
    mode === "none" ? null :
    mode === "auto" ? initialTarget :
    selected;

  /* Home's composition, one step in: an editorial hero panel whose bottom
     corners curve away, then the interaction itself on the dotted canvas
     below it. Same two radii constants Home uses — see frontend.md. */
  return (
    <>
      <section className="rounded-b-[2.5rem] bg-paper-sunken px-6 pt-16 pb-16 sm:rounded-b-[4.5rem] sm:px-10 sm:pt-24 sm:pb-20 lg:rounded-b-[7rem]">
        <div className="mx-auto max-w-[1400px]">

          <div className="flex items-baseline gap-4 font-mono text-[11px] uppercase tracking-[0.22em] text-ink-faint">
            <span>01</span>
            <span className="h-px flex-1 bg-line" />
            <span>Configuration</span>
          </div>

          <h1 className="mt-12 max-w-[20ch] text-[2.25rem] font-semibold leading-[1.05] tracking-[-0.035em] text-ink sm:text-5xl lg:text-6xl">
            Select a target column.
          </h1>

          <p className="mt-10 max-w-2xl border-t border-line pt-10 text-[16px] leading-[1.7] text-ink-soft">
            The target determines the ML task type, the class-balance report, and which
            columns are checked for leakage. Every other section of the report is computed
            either way — picking none is a valid answer, not a skipped step.
          </p>

          <div className="mt-14 grid grid-cols-2 border-t border-line sm:max-w-md">
            <div className="py-8 pr-8">
              <div className="font-mono text-4xl font-medium tracking-tight text-ink sm:text-5xl">
                {csvData.length.toLocaleString()}
              </div>
              <div className="mt-3 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint">Rows</div>
            </div>
            <div className="py-8 pr-8">
              <div className="font-mono text-4xl font-medium tracking-tight text-ink sm:text-5xl">
                {columns.length}
              </div>
              <div className="mt-3 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint">Columns</div>
            </div>
          </div>

        </div>
      </section>

      <section className="px-6 py-20 sm:px-10 sm:py-28">
        <div className="mx-auto max-w-2xl">
          <div className="rounded-[2rem] border border-line bg-paper-sunken p-6 sm:p-8">

            {/* Segmented control. The active segment wears the accent wash rather
                than a raised `bg-paper` tile: on a dark surface the page color
                is the DARKEST value, so the old lifted-tile treatment made the
                selected mode read as recessed. Same active token as the report's
                tab nav, so "selected" looks the same in both places. */}
            <div className="flex gap-1 rounded-xl bg-paper p-1">
              {TARGET_MODES.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setMode(opt.id)}
                  className={`flex-1 rounded-lg px-3 py-2 text-[12.5px] font-medium transition-colors ${
                    mode === opt.id ? "bg-accent-tint text-accent-ink" : "text-ink-soft hover:text-ink"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={mode}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
                className="mt-5"
              >
                <ModePanel
                  mode={mode}
                  columns={columns}
                  colTypes={colTypes}
                  selected={selected}
                  setSelected={setSelected}
                  initialTarget={initialTarget}
                />
              </motion.div>
            </AnimatePresence>

            <div className="mt-8 flex items-center justify-between border-t border-line pt-6">
              <button
                type="button"
                onClick={onBack}
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-soft transition-colors hover:text-ink"
              >
                <ArrowLeft size={14} />
                Back
              </button>
              <button
                type="button"
                onClick={() => onConfirm(effectiveTarget)}
                className="inline-flex items-center gap-2 rounded-xl bg-ink px-6 py-3 text-[13px] font-semibold text-paper transition-opacity hover:opacity-90"
              >
                Start Analysis
                <ArrowRight size={14} />
              </button>
            </div>

          </div>
        </div>
      </section>
    </>
  );
}

export default TargetStep;
