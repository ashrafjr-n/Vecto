import { useMemo } from "react";
import { ArrowRight, CircleCheckBig, CircleX, Info, TriangleAlert } from "lucide-react";

import SectionCard from "../shared/SectionCard.jsx";
import StatusBadge from "../shared/StatusBadge.jsx";
import { buildReadiness } from "../../../lib/readiness.js";

/* The first thing on the report: can this file be trained on as it stands, and if not,
   what comes first. Every line is a finding another section made (lib/readiness.js),
   with a link to the section that holds the evidence. */

const VERDICT = {
  blocked:   { severity: "critical", label: "Not ready to train", text: "Deal with the blockers first — training now would give a misleading model or score." },
  fix:       { severity: "warning",  label: "Ready after fixes",  text: "Nothing stops training, but the result will be weaker or optimistic until these are dealt with." },
  ready:     { severity: "success",  label: "Ready to train",     text: "Nothing in the report stands between this file and a first model." },
  no_target: { severity: "info",     label: "No target",          text: "Choose a target with “Change target” to get a verdict." },
};

const LEVEL = {
  blocker: { icon: CircleX,        cls: "text-critical", label: "Blocker" },
  fix:     { icon: TriangleAlert,  cls: "text-warning",  label: "Fix before training" },
  note:    { icon: Info,           cls: "text-ink-faint", label: "Worth knowing" },
};

function ReadinessCard({ result, tabLabels, onNavigate }) {
  const readiness = useMemo(() => buildReadiness(result), [result]);
  if (!readiness) return null;
  const verdict = VERDICT[readiness.verdict];

  return (
    <SectionCard title="Ready to train?" action={<StatusBadge severity={verdict.severity}>{verdict.label}</StatusBadge>}>
      <p className="text-[13.5px] leading-relaxed text-ink-soft">{verdict.text}</p>
      {readiness.items.length > 0 && (
        <ul className="mt-4 divide-y divide-line">
          {readiness.items.map((item, i) => {
            const level = LEVEL[item.level];
            const Icon = level.icon;
            const tabLabel = item.tab && tabLabels?.[item.tab];
            return (
              <li key={i} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <Icon size={15} className={`mt-0.5 shrink-0 ${level.cls}`} aria-label={level.label} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-medium text-ink">{item.title}</div>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-ink-soft">{item.detail}</p>
                  {tabLabel && (
                    <button
                      type="button"
                      onClick={() => onNavigate(item.tab)}
                      className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-medium text-accent-ink hover:underline"
                    >
                      {tabLabel}
                      <ArrowRight size={12} />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {readiness.verdict === "ready" && readiness.items.length === 0 && (
        <p className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] text-success">
          <CircleCheckBig size={13} /> No blockers and nothing to fix.
        </p>
      )}
    </SectionCard>
  );
}

export default ReadinessCard;
