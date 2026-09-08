import { getValues, normalizeValue } from "../helpers.js";

export function detectTarget(columns, data) {
  const targetNames = [
    "target", "label", "class", "outcome", "churn",
    "purchased", "survived", "default", "fraud",
    "status", "result", "y", "output",
  ];

  // 1. Name match — highest priority
  const byName = columns.find(c =>
    targetNames.includes(c.toLowerCase().trim())
  );
  if (byName) return byName;

  // 2. Binary values — but skip columns that look like feature flags
  //    Prefer the LAST binary column found (more likely to be target)
  const binaryCols = columns.filter(col => {
    const vals   = getValues(data, col);
    const unique = [...new Set(vals.map(v => normalizeValue(v)))];
    return unique.length === 2 && (
      (unique.includes("0") && unique.includes("1")) ||
      (unique.includes("yes") && unique.includes("no")) ||
      (unique.includes("true") && unique.includes("false"))
    );
  });
  if (binaryCols.length > 0) return binaryCols[binaryCols.length - 1];

  // 3. Low cardinality (≤ 5% unique) — check from the end, targets are usually last
  const byCardinality = [...columns].reverse().find(col => {
    const vals   = getValues(data, col);
    const unique = new Set(vals).size;
    return unique / data.length <= 0.05 && unique >= 2;
  });
  if (byCardinality) return byCardinality;

  // 4. Last column fallback
  return columns[columns.length - 1];
}