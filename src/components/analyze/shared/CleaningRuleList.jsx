import { TYPE_LABEL, ruleKey, describeRule } from "./cleaningRuleText.js";

const pct = (x) => `${Math.round(x * 1000) / 10}%`;

/* The verified cleaning rules, each with what it did to a copy of the file, and a
   tick box for the ones that change something. One component for the target step
   (column review) and the Quality tab, so a rule reads the same in both places.
   `picked` is a Set of ruleKey()s. */
function CleaningRuleList({ rules, picked, onToggle }) {
  return (
    <ul className="divide-y divide-line rounded-xl border border-line bg-paper">
      {rules.map((r) => {
        const key = ruleKey(r);
        const m = r.measurement;
        return (
          <li key={key} className="px-4 py-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[13px] text-ink">{r.column}</span>
              <span className="text-[11.5px] text-ink-faint">{TYPE_LABEL[r.type]}</span>
            </div>
            <p className="mt-1 font-mono text-[11.5px] text-ink-soft">{describeRule(r)}</p>
            {r.reason && <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">{r.reason}</p>}
            <p className="mt-1.5 text-[12px] leading-relaxed text-ink">
              <span className="text-ink-faint">Applied to a copy: </span>
              {m.rowsChanged.toLocaleString()} values changed
              {r.type === "merge_levels"
                ? `; ${m.levelsBefore.toLocaleString()} → ${m.levelsAfter.toLocaleString()} distinct levels`
                : `; values that are numbers ${pct(m.numericShareBefore)} → ${pct(m.numericShareAfter)}`}.
            </p>
            {m.examples.length > 0 && (
              <p className="mt-1 font-mono text-[11px] text-ink-faint">{m.examples.map((e) => `${e.before} → ${e.after}`).join("   ·   ")}</p>
            )}
            {r.effective ? (
              <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-[12.5px] text-ink">
                <input type="checkbox" checked={picked.has(key)} onChange={() => onToggle(r)} className="h-3.5 w-3.5 accent-current" />
                Use this rule
              </label>
            ) : (
              <p className="mt-2 text-[12px] text-ink-faint">Not offered: it changes no value in this file.</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default CleaningRuleList;
