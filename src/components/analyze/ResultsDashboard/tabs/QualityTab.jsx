import { useMemo } from "react";
import { motion } from "framer-motion";
import { CircleCheckBig, CircleSlash, Hash, Layers, Minus } from "lucide-react";

import SectionCard from "../../shared/SectionCard.jsx";
import StatTile     from "../../shared/StatTile.jsx";

const ISSUE_ICON = { high_cardinality: Layers, constant: Minus, mixed_numeric: CircleSlash, possible_code: Hash };

const parseCount = (detail) => {
  const cleaned = String(detail ?? "0").replace(/[^\d.]/g, "");
  const n = Math.floor(Number(cleaned));
  return Number.isFinite(n) ? n : 0;
};

function severityTone(pct) {
  return pct > 20 ? "critical" : pct > 10 ? "warning" : "ink-faint";
}
const BAR_COLOR = { critical: "var(--color-critical)", warning: "var(--color-warning)", "ink-faint": "var(--color-ink-faint)" };
const TEXT_TONE = { critical: "text-critical", warning: "text-warning", "ink-faint": "text-ink-faint" };

// Tailwind's scanner is static/regex-based on raw source text — `text-${tone}`
// never appears as a literal class string, so nothing gets generated. Every
// class must resolve through a lookup of complete literal strings like this.
const SCORE_TEXT = { success: "text-success", warning: "text-warning", critical: "text-critical" };
const SCORE_BG   = { success: "bg-success",   warning: "bg-warning",   critical: "bg-critical"   };

function MissingRanking({ cols }) {
  if (!cols.length) return null;
  return (
    <SectionCard title="Missing values by column">
      <div className="space-y-2.5">
        {cols.map(({ col, count, pct }) => {
          const tone = severityTone(pct);
          return (
            <div key={col} className="flex items-center gap-3">
              <span className="w-32 shrink-0 truncate font-mono text-[12px] text-ink-soft">{col}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper-sunken">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: BAR_COLOR[tone] }}
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                />
              </div>
              <span className="w-14 shrink-0 text-right font-mono text-[11px] text-ink-faint">{count.toLocaleString()}</span>
              <span className={`w-12 shrink-0 text-right font-mono text-[12px] font-medium ${TEXT_TONE[tone]}`}>{Math.round(pct * 10) / 10}%</span>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

function OtherIssues({ items }) {
  if (!items.length) return null;
  return (
    <SectionCard title="Other issues">
      <div className="divide-y divide-line">
        {items.map((item) => {
          const Icon = ISSUE_ICON[item.issue] ?? Minus;
          return (
            /* Keyed by column AND issue: a column can now carry more than one
               entry here (a near-unique column with a few unparseable values is
               both high_cardinality and mixed_numeric), and the column name
               alone stopped being unique the moment mixed_numeric was added. */
            <div key={`${item.col}-${item.issue}`} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
              <Icon size={14} className="mt-0.5 shrink-0 text-ink-faint" />
              <div>
                <div className="font-mono text-[12.5px] text-ink">{item.col}</div>
                <div className="text-[12px] text-ink-soft">{item.detail}</div>
              </div>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

function QualityTab({ result }) {
  const { quality, meta } = result;
  const totalRows = meta?.rows;
  const rowsReady = totalRows > 0;
  const issues = quality?.columnsWithIssues;

  const missingCols = useMemo(() => (
    !rowsReady ? [] : (issues ?? [])
      .filter((c) => c.issue === "missing")
      .map((c) => {
        const count = parseCount(c.detail);
        const pct = Math.min(100, Math.max(0, (count / totalRows) * 100));
        return { col: c.col, count, pct };
      })
      .sort((a, b) => b.count - a.count)
  ), [issues, totalRows, rowsReady]);

  const otherIssues = useMemo(() => (issues ?? []).filter((c) => c.issue !== "missing"), [issues]);

  if (!rowsReady) return null;

  const score = quality.qualityScore;
  const tone = score >= 80 ? "success" : score >= 55 ? "warning" : "critical";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="Missing cells" value={quality.missingCells.toLocaleString()} tone={quality.missingCells > 0 ? "warning" : "success"} />
        <StatTile
          label="Duplicate rows"
          value={quality.duplicatesComputed ? quality.duplicateRows.toLocaleString() : "Skipped"}
          tone={!quality.duplicatesComputed ? "ink" : quality.duplicateRows > 0 ? "warning" : "success"}
        />
        <StatTile label="Missing %" value={`${quality.missingPct}%`} tone={quality.missingPct > 5 ? "warning" : "success"} />
      </div>

      <SectionCard title="Quality score">
        <div className="flex items-center justify-between">
          <div className={`font-mono text-3xl font-semibold ${SCORE_TEXT[tone]}`}>
            {score}<span className="text-sm font-normal text-ink-faint">/100</span>
          </div>
        </div>
        <div className="my-4 h-1.5 overflow-hidden rounded-full bg-paper-sunken">
          <motion.div
            className={`h-full rounded-full ${SCORE_BG[tone]}`}
            initial={{ width: 0 }}
            animate={{ width: `${score}%` }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          />
        </div>

        {quality.scorePenalties?.length > 0 ? (
          <div className="divide-y divide-line">
            <div className="flex items-center justify-between py-2 text-[12px]">
              <span className="text-ink-soft">Base score</span>
              <span className="font-mono font-medium text-success">+100</span>
            </div>
            {quality.scorePenalties.map((p) => (
              <div key={p.label} className="flex items-center justify-between gap-3 py-2">
                <div>
                  <div className="text-[12.5px] text-ink">{p.label}</div>
                  <div className="text-[11.5px] text-ink-faint">{p.detail}</div>
                </div>
                <span className="shrink-0 font-mono text-[12px] font-medium text-warning">−{p.penalty}</span>
              </div>
            ))}
            <div className="flex items-center justify-between pt-2.5 text-[12.5px] font-medium">
              <span className="text-ink-soft">Final score</span>
              <span className={`font-mono ${SCORE_TEXT[tone]}`}>{score}/100</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-[12.5px] text-success">
            <CircleCheckBig size={14} />
            No penalties — dataset passed all quality checks.
          </div>
        )}
      </SectionCard>

      <MissingRanking cols={missingCols} />
      <OtherIssues items={otherIssues} />

      {quality.columnsWithIssues.length === 0 && (
        <SectionCard>
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <CircleCheckBig size={22} className="text-success" />
            <div className="text-[14px] font-medium text-success">No issues detected</div>
            <div className="text-[12.5px] text-ink-faint">All columns passed quality checks.</div>
          </div>
        </SectionCard>
      )}
    </div>
  );
}

export default QualityTab;
