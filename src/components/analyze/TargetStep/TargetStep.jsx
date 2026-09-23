import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, ArrowLeft, Info, ChevronDown } from "lucide-react";

import { detectColumnRoles } from "../../utils/core/detectors/roles.js";
import { ROLE }              from "../../utils/core/roles.constants.js";
import RolePill               from "../shared/RolePill.jsx";
import AiBadge                from "../shared/AiBadge.jsx";
import AiDossier              from "./AiDossier.jsx";

const TARGET_MODES = [
  { id: "auto",   label: "Auto-detect"   },
  { id: "select", label: "Choose column" },
  { id: "none",   label: "No target"     },
];

function ModePanel({ mode, columns, colTypes, selected, setSelected, initialTarget, aiTarget, onUseTarget }) {
  if (mode === "auto") {
    if (!initialTarget) return null;
    const type = colTypes[initialTarget] ?? ROLE.CATEGORICAL;
    return (
      <div className="space-y-2">
        {/* Nested surfaces recess INWARD here: the enclosing panel is
            `paper-sunken` (the lifted token), so a box inside it takes `paper`.
            Reusing `paper-sunken` would make it vanish into its own container. */}
        <div className="flex items-center justify-between rounded-xl border border-line bg-paper px-4 py-3.5">
          <span className="font-mono text-[13px] text-ink">{initialTarget}</span>
          <div className="flex items-center gap-2">
            <RolePill role={type} />
            <span className="text-[11px] text-ink-faint">engine&apos;s guess</span>
          </div>
        </div>
        {/* The review's top pick beside the engine's, never in its place: on new files the
            engine's guess was right 3 times in 9 and the review's 9 in 9 (vecto-plan item 40),
            but choosing the target stays a click — the model's answer never moves it. */}
        {aiTarget && aiTarget === initialTarget && (
          <div className="flex items-center gap-2 px-1 text-[12px] text-ink-faint">
            <AiBadge>review</AiBadge> agrees with this target.
          </div>
        )}
        {aiTarget && aiTarget !== initialTarget && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-paper px-4 py-3.5">
            <span className="font-mono text-[13px] text-ink">{aiTarget}</span>
            <div className="flex items-center gap-2">
              <RolePill role={colTypes[aiTarget] ?? ROLE.CATEGORICAL} />
              <AiBadge>top pick</AiBadge>
              <button type="button" onClick={() => onUseTarget(aiTarget)} className="rounded-lg border border-line-strong px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-accent-tint">
                Use as target
              </button>
            </div>
          </div>
        )}
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
        Without a target there is no task type, class balance, target signal or
        preparation plan. Every other section runs normally.
      </div>
    );
  }

  return null;
}

/* `ai` (from Analyze.jsx) carries the column review state: dossier, role overrides, cleaning, accepted rules. */
/* `returning` is true when this was opened from a finished report ("Change
   target"), false for a file that has not been analysed yet. It changes two
   labels only: a page that says "Choose a target column" and "Back" is lying
   about where the user is and where Back goes. */
function TargetStep({ columns, csvData, encoding, initialTarget, onConfirm, onBack, returning, ai }) {
  const { dossier, onDossier, roleOverrides, onRoleOverridesChange, cleaning, onCleaning, acceptedRules, onAcceptedRulesChange, onOptIn } = ai;
  const [mode,     setMode]     = useState("auto");
  const [selected, setSelected] = useState(initialTarget || columns[0] || "");

  // Single source of truth: the same role detector the analyzer runs. Passing a null
  // target keeps every column's natural role — so an ID column is still surfaced as
  // "identifier" here, which is exactly the warning a user needs while picking.
  const colTypes = useMemo(
    () => detectColumnRoles(csvData ?? [], columns, null),
    [columns, csvData],
  );
  // What the picker shows: detected roles, with any role the user accepted from the AI.
  const shownTypes = { ...colTypes, ...roleOverrides };

  const pickTarget = (col) => { setMode("select"); setSelected(col); };

  const effectiveTarget =
    mode === "none" ? null :
    mode === "auto" ? initialTarget :
    selected;

  // Columns in file order, each with the role the analysis will use for it.
  const columnList = columns.map((col) => ({ col, role: shownTypes[col] ?? ROLE.CATEGORICAL }));

  /* One quiet column: the heading and the file's facts, the picker, the optional
     AI review, then every column with its role — which doubles as the fastest
     way to choose a target by name. */
  return (
    <section className="px-6 pt-10 pb-24 sm:px-10 sm:pt-14">
      <div className="mx-auto max-w-3xl">

        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-4xl">
          {returning ? "Change the target column" : "Choose a target column"}
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-soft">
          The column you want to predict. It sets the task type, the class-balance check and
          the leakage checks. With no target you still get every other section of the report.
        </p>
        <p className="mt-4 font-mono text-[13px] text-ink-faint">
          {csvData.length.toLocaleString()} rows · {columns.length} columns
        </p>

        {/* decodeCsv fell back: the bytes were not UTF-8, and windows-1252 is a guess. */}
        {encoding === "windows-1252" && (
          <p className="mt-3 flex max-w-2xl items-start gap-2 text-[13px] leading-relaxed text-ink-soft">
            <Info size={14} className="mt-[3px] shrink-0 text-ink-faint" />
            This file is not UTF-8, so it was read as Windows-1252 (Western European). If any column name or value looks
            garbled, save the file as UTF-8 and upload it again.
          </p>
        )}

        {/* The AI column review sits ABOVE the picker and its Start analysis button
            on purpose (2026-09-23): it used to render below both, so a user could
            click through to the report without ever scrolling far enough to learn
            AI review exists. Moving it here costs nothing — Start analysis reads
            `effectiveTarget`, computed above regardless of where either panel is
            drawn — and it fixes the actual bug, rather than gating anything. */}
        <AiDossier
          data={csvData}
          columns={columns}
          roles={colTypes}
          dossier={dossier}
          onDossier={onDossier}
          overrides={roleOverrides}
          onOverridesChange={onRoleOverridesChange}
          currentTarget={effectiveTarget}
          onUseTarget={pickTarget}
          cleaning={cleaning}
          onCleaning={onCleaning}
          acceptedRules={acceptedRules}
          onAcceptedRulesChange={onAcceptedRulesChange}
          onOptIn={onOptIn}
        />

        <div className="mt-6 rounded-2xl border border-line bg-paper-sunken p-5 sm:p-6">

          {/* Segmented control. The active segment wears the accent wash rather
              than a raised `bg-paper` tile: on a dark surface the page color
              is the DARKEST value, so a lifted tile would read as recessed. */}
          <div className="flex gap-1 rounded-xl bg-paper p-1">
            {TARGET_MODES.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setMode(opt.id)}
                className={`flex-1 whitespace-nowrap rounded-lg px-1.5 py-2 text-[12px] font-medium transition-colors sm:px-3 sm:text-[12.5px] ${
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
                colTypes={shownTypes}
                selected={selected}
                setSelected={setSelected}
                initialTarget={initialTarget}
                aiTarget={dossier?.targets?.[0]?.column ?? null}
                onUseTarget={pickTarget}
              />
            </motion.div>
          </AnimatePresence>

          <div className="mt-6 flex items-center justify-between border-t border-line pt-5">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-soft transition-colors hover:text-ink"
            >
              <ArrowLeft size={14} />
              {returning ? "Back to report" : "Back"}
            </button>
            <button
              type="button"
              onClick={() => onConfirm(effectiveTarget)}
              className="inline-flex items-center gap-2 rounded-xl bg-ink px-5 py-2.5 text-[13px] font-semibold text-paper transition-opacity hover:opacity-90"
            >
              {returning ? "Rebuild the report" : "Start analysis"}
              <ArrowRight size={14} />
            </button>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-line bg-paper-sunken p-5 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[14px] font-semibold tracking-tight text-ink">Columns</h2>
            <span className="text-[12px] text-ink-faint">Select one to use it as the target</span>
          </div>
          <ul className="mt-4 grid gap-1.5 sm:grid-cols-2">
            {columnList.map(({ col, role }) => (
              <li key={col}>
                <button
                  type="button"
                  onClick={() => pickTarget(col)}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                    effectiveTarget === col ? "border-line-strong bg-accent-tint" : "border-line bg-paper hover:border-line-strong"
                  }`}
                >
                  <span className="min-w-0 truncate font-mono text-[12.5px] text-ink">{col}</span>
                  <RolePill role={role} />
                </button>
              </li>
            ))}
          </ul>
        </div>

      </div>
    </section>
  );
}

export default TargetStep;
