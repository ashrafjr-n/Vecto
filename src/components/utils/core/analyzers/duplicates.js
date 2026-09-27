/* Repeated records beyond exact duplicates — two findings a row-for-row comparison
   cannot make, both about what a model is asked to learn and how it is scored:

   conflicts   rows identical on every feature but carrying DIFFERENT targets. No model
               can be right on both; if they are real, the label is noisy there, and if
               they are errors, they cap every score. (Identifiers are left out of
               "every feature": an id makes every row unique by construction.)
   idOnlyRows  rows identical on every column except the identifiers, with the same
               target — the same record entered twice under a new id. A random split
               can put the two copies on both sides, which is leakage an exact-
               duplicate check never sees.

   Pure, one pass per key. A row's key is its values joined by a unit separator, which
   no CSV cell is expected to hold — measured 594 ms for 400,000 rows × 17 columns. */

import { isMissing, normalizeValue } from "../helpers.js";

const SEP = "\u001f";
const EXAMPLE_GROUPS = 3;
const EXAMPLE_ROWS = 5;

/* Key of a row over `cols`. Raw values, as the exact-duplicate check reads them. */
export function rowKey(row, cols) {
  let key = "";
  for (let i = 0; i < cols.length; i++) key += (row[cols[i]] ?? "") + SEP;
  return key;
}

/* Below this share of distinct feature combinations among rows, the features are too
   coarse for a repeat to mean a copy: with two cities and three age bands, most rows
   share their features with another by chance. Copies come in pairs; coarse features
   come in large groups, and they pull the share down far faster. */
export const COARSE_FEATURE_SHARE = 0.5;

/* → { featureColumns, distinctShare, coarse, idOnlyRows, conflicts: { groups, rows, examples } | null } */
export function getDuplicates(data, columns, target, identifierCols = []) {
  const ids = new Set(identifierCols);
  const featureColumns = columns.filter(c => c !== target && !ids.has(c));
  if (!target || featureColumns.length === 0) return { featureColumns, distinctShare: null, coarse: false, idOnlyRows: 0, conflicts: null };

  /* feature key → { first row, targets seen (normalized → a spelling), rows } */
  const groups = new Map();
  const seenWithTarget = new Set();
  const seenExact = new Set();
  let idOnlyRows = 0;
  let withTargetRows = 0;

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const raw = row[target];
    if (isMissing(raw)) continue;
    const fKey = rowKey(row, featureColumns);
    const t = normalizeValue(raw);
    withTargetRows++;

    if (ids.size > 0) {
      // Same features, same target. An exact duplicate is counted by Quality; only a
      // copy that differs in its identifiers is counted here.
      const withTarget = fKey + t;
      const exact = rowKey(row, columns);
      if (seenWithTarget.has(withTarget)) {
        if (!seenExact.has(exact)) idOnlyRows++;
      } else seenWithTarget.add(withTarget);
      seenExact.add(exact);
    }

    let g = groups.get(fKey);
    if (!g) groups.set(fKey, (g = { targets: new Map(), rows: [], count: 0 }));
    g.count++;
    if (!g.targets.has(t)) g.targets.set(t, String(raw).trim());
    if (g.rows.length < EXAMPLE_ROWS) g.rows.push(i);
  }

  let conflictGroups = 0, conflictRows = 0;
  const examples = [];
  for (const g of groups.values()) {
    if (g.targets.size < 2) continue;
    conflictGroups++;
    conflictRows += g.count;
    if (examples.length < EXAMPLE_GROUPS) {
      examples.push({
        // File line numbers: data is 0-indexed and the header is line 1.
        lines: g.rows.slice(0, EXAMPLE_ROWS).map(i => i + 2),
        targets: [...g.targets.values()],
      });
    }
  }

  const distinctShare = withTargetRows ? Math.round((groups.size / withTargetRows) * 1000) / 1000 : null;
  return {
    featureColumns,
    distinctShare,
    coarse: distinctShare !== null && distinctShare < COARSE_FEATURE_SHARE,
    idOnlyRows,
    conflicts: { groups: conflictGroups, rows: conflictRows, examples },
  };
}
