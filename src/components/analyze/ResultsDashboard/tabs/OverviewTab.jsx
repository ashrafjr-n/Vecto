import { useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown, X } from "lucide-react";

import SectionCard from "../../shared/SectionCard.jsx";
import AiBadge      from "../../shared/AiBadge.jsx";
import StatusBadge  from "../../shared/StatusBadge.jsx";
import { useSession } from "../../../auth/sessionContext.js";
import { ROLE }      from "../../../utils/core/roles.constants.js";

/* ─────────────────────────────────────────────
   HEALTH SCORE — radial gauge (a single ratio against a limit -> meter, in
   circular form). Fill color carries the score's severity, not the brand
   accent: this is a good/bad signal, so it wears status tokens, not the accent.
───────────────────────────────────────────── */
const SIZE = 116, STROKE = 10, R = (SIZE - STROKE) / 2, C = 2 * Math.PI * R;

function scoreTone(score) {
  return score >= 80 ? "success" : score >= 60 ? "warning" : "critical";
}
const TONE_STROKE = { success: "var(--color-success)", warning: "var(--color-warning)", critical: "var(--color-critical)" };
const TONE_TEXT   = { success: "text-success", warning: "text-warning", critical: "text-critical" };

function RadialGauge({ score }) {
  const tone = scoreTone(score);
  const offset = C * (1 - score / 100);
  return (
    <div className="relative" style={{ width: SIZE, height: SIZE }}>
      <svg width={SIZE} height={SIZE} className="-rotate-90">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--color-paper)" strokeWidth={STROKE} />
        <motion.circle
          cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none"
          stroke={TONE_STROKE[tone]} strokeWidth={STROKE} strokeLinecap="round"
          strokeDasharray={C}
          initial={{ strokeDashoffset: C }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.7, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className={`font-mono text-2xl font-semibold ${TONE_TEXT[tone]}`}>{score}</div>
        <div className="text-[10px] text-ink-faint">/100</div>
      </div>
    </div>
  );
}

const DIM_LABEL = { quality: "Quality", structure: "Structure", relationships: "Relationships", targetReadiness: "Target readiness" };

/* Why the score is lower than the weighted dimensions would suggest.

   Stage 5 added a cap layer: the score may not claim more than the evidence
   supports, and each cap carries its reason. Until now only the smaller NUMBER
   reached the user — titanic reads 89 instead of 93 with nothing on screen
   explaining it, which is precisely the "confident number, no reasoning" failure
   the caps were added to prevent. `limits` is [] on an uncapped run, so this
   renders nothing in the ordinary case. */
function ScoreLimits({ limits }) {
  if (!limits?.length) return null;
  return (
    <div className="mt-4 border-t border-line pt-3">
      <div className="mb-2 flex items-center gap-2">
        <StatusBadge severity="warning">Score capped</StatusBadge>
        <span className="text-[11.5px] text-ink-faint">
          {limits.length === 1 ? "One limit applied" : `${limits.length} limits applied`} — the lowest one holds
        </span>
      </div>
      <ul className="space-y-1.5">
        {limits.map((cap, i) => (
          <li key={i} className="flex items-start gap-2 text-[12px] leading-relaxed text-ink-soft">
            <span className="mt-px shrink-0 rounded bg-paper px-1.5 py-0.5 font-mono text-[10.5px] text-ink-faint">
              max {cap.max}
            </span>
            <span>{cap.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HealthScoreCard({ healthScore }) {
  if (!healthScore) return null;
  const { score, grade, breakdown, hasTarget, limits } = healthScore;
  const dims = Object.entries(breakdown).filter(([k]) => hasTarget || k !== "targetReadiness");

  return (
    <SectionCard title="Health score">
      <div className="flex items-center gap-6">
        <RadialGauge score={score} />
        <div className="flex-1 space-y-3">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-semibold text-ink">Grade {grade}</span>
          </div>
          {dims.map(([key, val]) => {
            const tone = scoreTone(val);
            return (
              <div key={key}>
                <div className="mb-1 flex items-center justify-between text-[11px]">
                  <span className="text-ink-soft">{DIM_LABEL[key]}</span>
                  <span className={`font-mono font-medium ${TONE_TEXT[tone]}`}>{val}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-paper">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: TONE_STROKE[tone] }}
                    initial={{ width: 0 }}
                    animate={{ width: `${val}%` }}
                    transition={{ duration: 0.6, ease: "easeOut" }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <ScoreLimits limits={limits} />
    </SectionCard>
  );
}

/* ─────────────────────────────────────────────
   COLUMN ROLES — grouped, same RolePill as TargetStep
───────────────────────────────────────────── */
function ColumnRolesCard({ meta }) {
  /* Grouped from meta.columnRoles, which is the engine's actual verdict per
     column, rather than from meta.numericCols / meta.categoricalCols.

     Those derived lists fold ROLE.BINARY into categoricalCols (index.js:28) —
     correct for routing, since binary and categorical feed the same analyses —
     but this card was reading them as if they were the roles themselves. The
     result was two screens disagreeing about the same column: the target picker
     calls detectColumnRoles directly and shows "Sex — binary", and this report
     then called it "categorical". RolePill has always had a binary style that
     could not render here.

     The target keeps its own group and is excluded from the role groups, so it
     is still named once. "target" is not a ROLE value (there is no ROLE.TARGET)
     and is filtered out before it can reach RolePill — see the gotcha in
     CLAUDE.md; that behaviour is unchanged. */
  const byRole = {};
  Object.entries(meta.columnRoles ?? {}).forEach(([col, role]) => {
    if (col === meta.target) return;
    (byRole[role] ??= []).push(col);
  });

  const groups = [
    { role: "target",         label: "Target",      cols: meta.target ? [meta.target] : [] },
    { role: ROLE.NUMERIC,     label: "Numeric",     cols: byRole[ROLE.NUMERIC]     ?? [] },
    { role: ROLE.BINARY,      label: "Binary",      cols: byRole[ROLE.BINARY]      ?? [] },
    { role: ROLE.CATEGORICAL, label: "Categorical", cols: byRole[ROLE.CATEGORICAL] ?? [] },
    { role: ROLE.IDENTIFIER,  label: "Identifier",  cols: byRole[ROLE.IDENTIFIER]  ?? [] },
    { role: ROLE.TEMPORAL,    label: "Temporal",    cols: byRole[ROLE.TEMPORAL]    ?? [] },
    { role: ROLE.TEXT,        label: "Free text",   cols: byRole[ROLE.TEXT]        ?? [] },
  ].filter((g) => g.cols.length > 0);

  return (
    <SectionCard title="Column roles">
      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.role}>
            <div className="mb-1.5 text-[11px] font-medium text-ink-faint">{g.label} ({g.cols.length})</div>
            <div className="flex flex-wrap gap-1.5">
              {g.cols.map((col) => (
                <span key={col} className="inline-flex items-center gap-1.5 rounded-md border border-line bg-paper px-2 py-1 font-mono text-[11px] text-ink">
                  {col}
                  {meta.roleOverrides?.[col] && (
                    <AiBadge title={`Detected as ${meta.roleOverrides[col].from}; you chose ${meta.roleOverrides[col].to} (suggested by AI)`}>
                      set by you
                    </AiBadge>
                  )}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

/* ─────────────────────────────────────────────
   DATASET SNAPSHOT — raw preview table
───────────────────────────────────────────── */
function DatasetSnapshot({ snapshot }) {
  if (!snapshot?.rows?.length) return null;
  const { columns, rows } = snapshot;
  const visibleCols = columns.slice(0, 8);
  const hiddenCount = columns.length - visibleCols.length;

  return (
    <SectionCard
      title="Data preview"
      action={
        <span className="text-[11px] text-ink-faint">
          First {rows.length} rows{hiddenCount > 0 ? ` · +${hiddenCount} cols hidden` : ""}
        </span>
      }
    >
      <div className="-mx-5 overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-line">
              <th className="w-10 px-3 py-2 text-right font-mono text-[10px] font-normal text-ink-faint">#</th>
              {visibleCols.map((col) => (
                <th key={col} className="whitespace-nowrap px-3 py-2 text-left text-[11px] font-medium text-ink-soft">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-line/60 hover:bg-paper">
                <td className="px-3 py-1.5 text-right font-mono text-[10px] text-ink-faint">{i + 1}</td>
                {visibleCols.map((col) => {
                  const val = row[col];
                  const isNull = val === null || val === undefined;
                  return (
                    <td key={col} className="max-w-[160px] truncate px-3 py-1.5 font-mono text-ink-soft">
                      {isNull
                        ? <span className="rounded bg-warning-tint px-1.5 py-0.5 text-[10px] font-medium text-warning">null</span>
                        : String(val)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

/* ─────────────────────────────────────────────
   PRIORITY INSIGHTS
───────────────────────────────────────────── */
const SEVERITY_RANK = { critical: 0, warning: 1, info: 2, success: 3 };

function InsightsCard({ insights }) {
  if (!insights?.length) return null;
  const sorted = [...insights].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

  return (
    <SectionCard title="Key findings">
      {/* Titles only until opened: the detail of most findings is the same sentence
          the recommendation beside it gives, and printed twice it read as noise. */}
      <div className="divide-y divide-line">
        {sorted.map((ins, i) => (
          <details key={i} className="group py-2.5 first:pt-0 last:pb-0">
            <summary className="flex cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
              <StatusBadge severity={ins.severity}>{ins.severity}</StatusBadge>
              <span className="flex-1 text-[13px] font-medium text-ink">{ins.title}</span>
              <ChevronDown size={14} className="shrink-0 text-ink-faint transition-transform group-open:rotate-180" />
            </summary>
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-soft">{ins.text}</p>
          </details>
        ))}
      </div>
    </SectionCard>
  );
}

/* ─────────────────────────────────────────────
   RECOMMENDATIONS
───────────────────────────────────────────── */
const PRIORITY_TONE = { high: "critical", medium: "warning", low: "info" };

function RecommendationsCard({ recommendations }) {
  const [expanded, setExpanded] = useState(false);
  if (!recommendations?.length) return null;
  const shown = expanded ? recommendations : recommendations.slice(0, 4);

  return (
    <SectionCard title="Recommendations">
      <div className="space-y-4">
        {shown.map((rec, i) => (
          <div key={i} className="border-b border-line pb-4 last:border-0 last:pb-0">
            <div className="flex items-center gap-2">
              <StatusBadge severity={PRIORITY_TONE[rec.priority] ?? "info"}>{rec.priority}</StatusBadge>
              <span className="text-[11px] text-ink-faint">{rec.category}</span>
              {rec.column && <span className="font-mono text-[11px] text-ink-soft">"{rec.column}"</span>}
            </div>
            <div className="mt-1.5 text-[13px] text-ink">{rec.issue}</div>
            <div className="mt-0.5 text-[12.5px] leading-relaxed text-ink-soft">{rec.action}</div>
            {/* The reason the engine gives this advice. It was computed for every
                recommendation and rendered nowhere — advice without a reason can
                only be obeyed or ignored, and the reason is what lets a user
                disagree with it on the evidence. */}
            {rec.rationale && (
              <p className="mt-2 border-l-2 border-line pl-3 text-[12px] leading-relaxed text-ink-faint">
                {rec.rationale}
              </p>
            )}
          </div>
        ))}
      </div>
      {recommendations.length > 4 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-4 text-[12.5px] font-medium text-accent-ink hover:underline"
        >
          {expanded ? "Show less" : `Show ${recommendations.length - 4} more`}
        </button>
      )}
    </SectionCard>
  );
}

/* ─────────────────────────────────────────────
   DEEPER REVIEW POINTER — the framing this tab did not previously state anywhere.
   Everything above and below this card is the engine's own work; nothing here
   changes that. It renders once, the first time a report is seen, and only until
   the report already carries a review answer (columns or leakage) or the visitor
   dismisses it — asking again on every visit would read as nagging.

   The prose deliberately never says "AI": the badge is the disclosure, and each
   panel states what it sends at the point of asking. Naming the technology in
   body copy is what made the product read as a wrapper around one.

   Deliberately no benchmark numbers (19/19 vs 8/19): real, but not yet decided
   as a public claim (vecto-plan). If that's exposed later, it belongs here. */
function AiNudgeCard({ ai }) {
  const [dismissed, setDismissed] = useState(false);
  const { user, signIn } = useSession();
  const alreadyUsed = Boolean(ai?.dossier) || Boolean(ai?.leakageReview);
  if (dismissed || alreadyUsed) return null;

  return (
    <SectionCard
      title={<span className="inline-flex items-center gap-2">About this report<AiBadge>optional</AiBadge></span>}
      action={
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="rounded-md p-1 text-ink-faint transition-colors hover:bg-paper hover:text-ink"
        >
          <X size={14} />
        </button>
      }
    >
      <p className="text-[13px] leading-relaxed text-ink-soft">
        Every figure in this report is computed by Vecto&apos;s engine, in this browser tab.
        A deeper review is a separate, optional step: it reads a summary of your columns and
        proposes what each one means, whether a strong signal is leakage or a real predictor,
        and which column is the target. Nothing it proposes enters the report unless you
        accept it.
      </p>
      {user ? (
        <p className="mt-3 text-[12.5px] leading-relaxed text-ink-faint">
          Leakage review is on Target Signal, cleaning proposals on Quality, and the column
          review sits with the target under &ldquo;Change target&rdquo;.
        </p>
      ) : (
        /* A secondary button, not the solid ink one: this is a notice, not the page's
           action. The label names the mechanism (GitHub) rather than selling the
           feature — "Sign in for the deeper review" read as a pitch. */
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="button"
            onClick={signIn}
            className="inline-flex items-center rounded-xl border border-line-strong px-4 py-2.5 text-[13px] font-semibold text-ink transition-colors hover:bg-accent-tint"
          >
            Sign in with GitHub
          </button>
          <span className="text-[12.5px] text-ink-faint">
            Needed for the deeper review only — this report is already complete.
          </span>
        </div>
      )}
    </SectionCard>
  );
}

/* ─────────────────────────────────────────────
   OVERVIEW TAB
───────────────────────────────────────────── */
function OverviewTab({ result, ai }) {
  const { meta, snapshot, healthScore, insights, recommendations } = result;

  return (
    <div className="space-y-4">
      <AiNudgeCard ai={ai} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[380px_1fr]">
        <HealthScoreCard healthScore={healthScore} />
        <ColumnRolesCard meta={meta} />
      </div>
      <DatasetSnapshot snapshot={snapshot} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <InsightsCard insights={insights} />
        <RecommendationsCard recommendations={recommendations} />
      </div>
    </div>
  );
}

export default OverviewTab;
