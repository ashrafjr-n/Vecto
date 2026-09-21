import { useState } from "react";
import { motion } from "framer-motion";
import { CircleX } from "lucide-react";

import SectionCard from "../../shared/SectionCard.jsx";
import StatusBadge  from "../../shared/StatusBadge.jsx";
import { correlationFill, correlationText } from "../../shared/correlationColor.js";
import AiBadge from "../../shared/AiBadge.jsx";
import { SENSITIVE_LABEL, flaggedColumns, proxiesFor, unmeasuredCount, PROXY_MIN_V, PROXY_MIN_R } from "../../shared/sensitive.js";

function LeakageWarnings({ suspects }) {
  if (!suspects?.length) return null;
  return (
    <div className="space-y-2">
      {suspects.map((leak, i) => (
        <div key={i} className="flex items-start gap-3 rounded-lg border border-critical/20 bg-critical-tint px-4 py-3">
          <CircleX size={15} className="mt-0.5 shrink-0 text-critical" />
          <div>
            <div className="text-[13px] font-semibold text-critical">Possible target leakage</div>
            <div className="text-[12.5px] text-ink-soft">{leak.warning}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Observations({ observations }) {
  if (!observations?.length) return null;
  return (
    <SectionCard title="Dataset observations">
      <ul className="space-y-1.5">
        {observations.map((obs, i) => (
          <li key={i} className="flex items-start gap-2 text-[12.5px] text-ink-soft">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
            {obs}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

/* Diverging by sign: terracotta = positive, info blue = negative, per
   correlationColor.js — the same encoding as the heatmap below, so ranking and
   grid never disagree. */
function CorrelationRanking({ strongRelationships }) {
  if (!strongRelationships.length) {
    return (
      <SectionCard>
        <div className="py-6 text-center text-[13px] text-ink-faint">No strong correlations found (|r| &gt; 0.4).</div>
      </SectionCard>
    );
  }

  return (
    <SectionCard title={`Top relationships — ${strongRelationships.length} found`}>
      <div className="divide-y divide-line">
        {strongRelationships.map((rel, i) => {
          const abs = Math.abs(rel.correlation);
          const isMC = abs >= 0.9;
          const fill = correlationFill(rel.correlation);

          return (
            <div key={i} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-center gap-3">
                <span className="w-4 shrink-0 text-right font-mono text-[10px] text-ink-faint">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-soft">
                  {rel.col1} <span className="text-ink-faint">&harr;</span> {rel.col2}
                </span>
                <div className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-paper">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.round(abs * 100)}%` }}
                    transition={{ delay: i * 0.03, duration: 0.4, ease: "easeOut" }}
                    className="h-full rounded-full"
                    style={{ background: fill }}
                  />
                </div>
                <span className="w-14 shrink-0 text-right font-mono text-[12px] font-semibold text-ink">
                  r = {rel.correlation.toFixed(2)}
                </span>
                {isMC
                  ? <StatusBadge severity="critical">redundant</StatusBadge>
                  : <span className="shrink-0 rounded-full bg-paper px-2.5 py-0.5 text-[11px] text-ink-soft">{rel.strength}</span>}
              </div>

              {/* Stage 7 computed a Spearman and a p-value for every pair here and
                  the row showed neither — so a pair that is strongly monotonic but
                  barely linear looked weak, and a coefficient from 8 rows read the
                  same as one from 891. */}
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-7 text-[11.5px] text-ink-faint">
                {rel.pValue != null && (
                  <span>
                    {rel.pValue < 0.05 ? "distinguishable from chance" : "not distinguishable from chance"}
                    {" ("}{rel.pValue < 0.001 ? "p < 0.001" : `p = ${rel.pValue.toFixed(3)}`}
                    {", n = "}{rel.nPairs.toLocaleString()})
                  </span>
                )}
                {rel.monotonicNotLinear && (
                  <span className="rounded bg-accent-tint px-1.5 py-0.5 text-[11px] text-accent-ink">
                    Spearman {rel.spearman.toFixed(2)} — monotonic, not linear
                  </span>
                )}
              </div>

              {rel.statement && (
                <div className="mt-1.5 pl-7 text-[11.5px] italic text-ink-faint">{rel.statement}</div>
              )}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

/* The categorical counterpart to the heatmap below, which covers numericCols
   only — 4 of titanic's 12 columns. Two category columns encoding the same thing
   were undetectable: the engine could report that Age and Fare move together but
   not that Ticket and Cabin do. Same Bergsma-corrected Cramér's V used against
   the target, so the two can be read on one scale.

   This lives here rather than in Target Signal because it is a feature-to-feature
   relationship — redundancy between columns, not evidence about the target. */
function CategoricalAssociations({ associations, hasHeatmap }) {
  if (!associations?.length) return null;

  return (
    <SectionCard
      title={`Categorical associations — ${associations.length} found`}
      action={<span className="font-mono text-[11px] text-ink-faint">Cramér's V · 0 to 1</span>}
    >
      <p className="-mt-2 mb-3 text-[12px] leading-relaxed text-ink-faint">
        {hasHeatmap ? "The heatmap below covers numeric columns only. These are pairs of" : "These are pairs of"}{" "}
        categorical columns that carry overlapping information — encoding both costs
        feature space without adding signal.
      </p>
      <div className="divide-y divide-line">
        {associations.map((a, i) => (
          <div key={`${a.col1}|${a.col2}`} className="py-3 first:pt-0 last:pb-0">
            <div className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-soft">
                {a.col1} <span className="text-ink-faint">&harr;</span> {a.col2}
              </span>
              <div className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-paper">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.round(a.cramersV * 100)}%` }}
                  transition={{ delay: Math.min(i * 0.04, 0.4), duration: 0.4, ease: "easeOut" }}
                  className="h-full rounded-full"
                  style={{ background: correlationFill(a.cramersV) }}
                />
              </div>
              <span className="w-14 shrink-0 text-right font-mono text-[12px] font-semibold text-ink">
                V = {a.cramersV.toFixed(2)}
              </span>
              {a.cramersV >= 0.6 && <StatusBadge severity="warning">redundant</StatusBadge>}
            </div>
            <div className="mt-1 text-[11.5px] text-ink-faint">
              {a.levels[0]} × {a.levels[1]} levels over {a.nPairs.toLocaleString()} rows
              {a.pValue != null && (
                <> · {a.pValue < 0.001 ? "p < 0.001" : `p = ${a.pValue.toFixed(3)}`}</>
              )}
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}


/* ── Columns that stand in for a flagged one (vecto-plan item 32) ──────────────
   Dropping a sensitive column does not remove the attribute if another column
   predicts it. The measurements here are the engine's own, already computed for
   this report — nothing new is asked of a model, and the only AI part is WHICH
   columns to look up.

   It renders only when the review flagged something. There is deliberately no
   "no sensitive columns found" state: the flags come from a model that was asked
   about this file once, so their absence means nobody looked or nothing was
   answered — never that the file holds no personal data. An all-clear here would
   be the one sentence in the report that is not a measurement. */
function SensitiveProxies({ relationships, dossier, roles }) {
  const flagged = flaggedColumns(dossier);
  if (!flagged.length) return null;

  return (
    <SectionCard
      title="Columns that stand in for personal data"
      action={<AiBadge>flagged by AI, measured by the engine</AiBadge>}
    >
      <p className="-mt-2 mb-3 text-[12px] leading-relaxed text-ink-faint">
        The review read {flagged.length} column{flagged.length > 1 ? "s" : ""} as recording a
        personal attribute. Removing one does not remove the attribute if another column
        predicts it, so each is listed with the columns this report already measured it
        against. The associations are the engine's; only the flag is the model's.
      </p>
      <div className="divide-y divide-line">
        {flagged.map((col) => {
          const proxies = proxiesFor(col.name, relationships);
          const unmeasured = unmeasuredCount(col.name, roles);
          return (
            <div key={col.name} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-[13px] font-semibold text-ink">{col.name}</span>
                <span className="text-[12px] text-ink-soft">read as {SENSITIVE_LABEL[col.sensitive]}</span>
              </div>
              {proxies.length > 0 ? (
                <ul className="mt-1.5 space-y-1">
                  {proxies.map((p) => (
                    <li key={`${p.other}|${p.metric}`} className="flex items-center gap-3 text-[12.5px] text-ink-soft">
                      <span className="min-w-0 flex-1 truncate">{p.other}</span>
                      <span className="w-24 shrink-0 text-right font-mono text-[12px] text-ink">
                        {p.metric} = {p.value.toFixed(2)}
                      </span>
                      <span className="w-28 shrink-0 text-right text-[11.5px] text-ink-faint">
                        {p.n.toLocaleString()} rows
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1.5 text-[12px] text-ink-faint">
                  No column reached the reporting bar against this one
                  {" "}(V &ge; {PROXY_MIN_V}, |r| &ge; {PROXY_MIN_R}).
                </p>
              )}
              {unmeasured > 0 && (
                <p className="mt-1 text-[11.5px] text-ink-faint">
                  {unmeasured} column{unmeasured > 1 ? "s were" : " was"} not compared with it at
                  all: between features the engine measures numeric against numeric and
                  categorical against categorical, never one against the other. Silence above
                  is not evidence that nothing stands in for this column.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

/* Swatches are READ FROM the ramp at a representative r, not copied as hexes.
   They used to be five literals duplicating correlationColor.js, so the legend
   described the previous palette the moment the ramp changed — the legend is the
   key to the grid, and a key that disagrees with the grid is worse than none. */
const LEGEND = [
  { r:  0.95, label: "Strong +"   },
  { r:  0.50, label: "Moderate +" },
  { r:  0.00, label: "Weak"       },
  { r: -0.50, label: "Moderate −" },
  { r: -0.95, label: "Strong −"   },
];

function CorrelationHeatmap({ relationships }) {
  const { cols, correlationMatrix } = relationships;
  const [tip, setTip] = useState(null);

  const cellSize = cols.length <= 4 ? 60 : cols.length <= 6 ? 50 : cols.length <= 8 ? 42 : 34;
  const labelW = cols.length <= 4 ? 96 : cols.length <= 6 ? 84 : cols.length <= 8 ? 72 : 60;
  const showValue = cellSize >= 42;

  return (
    <SectionCard title="Correlation heatmap" className="relative">
      <div className="overflow-x-auto">
        <div className="flex" style={{ paddingLeft: labelW }}>
          {cols.map((col) => (
            <div key={col} className="shrink-0 truncate text-center font-mono text-[9px] text-ink-faint" style={{ width: cellSize }}>
              {col.length > 6 ? `${col.slice(0, 5)}…` : col}
            </div>
          ))}
        </div>

        {cols.map((rowCol, i) => (
          <div key={rowCol} className="mt-1 flex items-center">
            <div className="shrink-0 truncate pr-2 text-right font-mono text-[9px] text-ink-faint" style={{ width: labelW }}>
              {rowCol}
            </div>
            {cols.map((colCol, j) => {
              const key = `${rowCol}||${colCol}`;
              const val = correlationMatrix[key] ?? correlationMatrix[`${colCol}||${rowCol}`] ?? 0;
              const isDiag = rowCol === colCol;
              const isActive = tip?.row === i && tip?.col === j;
              return (
                <div
                  key={colCol}
                  onMouseEnter={() => !isDiag && setTip({ row: i, col: j, val, rowCol, colCol })}
                  onMouseLeave={() => setTip(null)}
                  className="mx-0.5 flex shrink-0 items-center justify-center rounded font-mono text-[9px] font-medium transition-transform"
                  style={{
                    width: cellSize, height: Math.round(cellSize * 0.62),
                    background: correlationFill(val), color: correlationText(val),
                    outline: isDiag ? "1px solid var(--color-line-strong)" : "none",
                    transform: isActive ? "scale(1.08)" : "scale(1)",
                    cursor: isDiag ? "default" : "crosshair",
                  }}
                >
                  {showValue ? val.toFixed(2) : ""}
                </div>
              );
            })}
          </div>
        ))}

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-3">
          <span className="text-[10px] text-ink-faint">Legend</span>
          {LEGEND.map((l) => (
            <div key={l.label} className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-sm border border-line" style={{ background: correlationFill(l.r) }} />
              <span className="text-[10px] text-ink-faint">{l.label}</span>
            </div>
          ))}
        </div>
      </div>

      {tip && (
        <div className="pointer-events-none absolute right-5 top-5 z-10 rounded-md border border-line bg-paper px-3 py-1.5 text-[12px] text-ink-soft shadow-sm">
          <strong className="text-ink">{tip.rowCol}</strong> &harr; <strong className="text-ink">{tip.colCol}</strong>
          {" — r = "}<strong className="font-mono text-ink">{tip.val.toFixed(3)}</strong>
        </div>
      )}
    </SectionCard>
  );
}

function RelationshipsTab({ result, ai }) {
  const { relationships } = result;
  const { cols } = relationships;

  /* `cols` is the NUMERIC correlation matrix, and it being empty used to blank the
     whole tab — hiding the leakage warnings, the categorical associations and the
     observations, none of which need a numeric column to exist. meets.csv has no
     numeric feature at all and a categorical column that determines the target at
     V = 0.99: the engine found it and this early return threw it away. */
  const hasNonNumericFindings = (relationships.leakageSuspects?.length ?? 0) > 0
    || (relationships.categoricalAssociations?.length ?? 0) > 0
    || (relationships.observations?.length ?? 0) > 0
    /* A flagged column needs no numeric column to exist, and the early return below
       would hide the proxy card exactly on the files most likely to carry one. */
    || flaggedColumns(ai?.dossier).length > 0;

  if (!cols.length && !hasNonNumericFindings) {
    return (
      <SectionCard>
        <div className="py-8 text-center text-[13px] text-ink-faint">Not enough numeric columns for relationship analysis.</div>
      </SectionCard>
    );
  }

  return (
    <div className="space-y-4">
      <LeakageWarnings suspects={relationships.leakageSuspects} />
      <Observations observations={relationships.observations} />
      <CategoricalAssociations associations={relationships.categoricalAssociations} hasHeatmap={cols.length > 0} />
      <SensitiveProxies relationships={relationships} dossier={ai?.dossier} roles={result.meta.columnRoles} />

      {/* Numeric-only sections. Rendering them with no numeric column produced an
          empty heatmap and a "no strong correlations found (|r| > 0.4)" line, which
          reads as "we looked and found nothing" about a scan that never ran. */}
      {cols.length > 0 ? (
        <>
          <CorrelationRanking strongRelationships={relationships.strongRelationships} />
          <CorrelationHeatmap relationships={relationships} />
        </>
      ) : (
        <SectionCard>
          <div className="py-4 text-center text-[12.5px] text-ink-faint">
            No numeric feature columns, so there is no correlation matrix or heatmap.
            The findings above are measured on the categorical columns.
          </div>
        </SectionCard>
      )}
    </div>
  );
}

export default RelationshipsTab;
