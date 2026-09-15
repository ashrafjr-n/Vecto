/* How a cleaning rule is named and written out for a reader — shared by the rule
   list (target step and Quality tab) and the Quality tab's applied-rules summary. */

export const TYPE_LABEL = {
  unit_map:         "Convert units",
  censored_numeric: "Read bounds as numbers",
  treat_as_missing: "Treat as missing",
  merge_levels:     "Merge spellings",
};

export const ruleKey = (r) => `${r.column}|${r.type}`;

export function describeRule(r) {
  if (r.type === "unit_map") return r.affixes.map((a) => `"${a.affix}" × ${a.factor.toLocaleString()}`).join(", ");
  if (r.type === "censored_numeric") return r.affixes.map((a) => `"${a.affix}" → the number itself`).join(", ");
  if (r.type === "treat_as_missing") return r.values.map((v) => `"${v}"`).join(", ");
  return r.merges.map((m) => `"${m.from}" → "${m.to}"`).join(", ");
}
