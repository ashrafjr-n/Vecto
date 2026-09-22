/* Same target within a repeated value — a measurement for the leakage review (C) and
   the reader, 0 requests. Pure. */

import { isMissing, normalizeValue } from "../../components/utils/core/helpers.js";
import { ROLE } from "../../components/utils/core/roles.constants.js";
import { ENTITY_KEY_MIN_DISTINCT } from "../../components/utils/core/detectors/roles.js";

const sig = (x) => Number(x.toPrecision(4));

/* A column whose repeated values almost always carry the same target: an entity a
   random split would memorise (Spotify's track_id, the one leak the model missed on
   the final set), a value recorded after the outcome (Himalaya's highpoint_metres),
   or an artefact of how the file was built (Parkinsons' test_time). Which of those it
   is, is meaning — so this is EVIDENCE handed to the model and shown to the reader,
   never a verdict.
     more than ENTITY_KEY_MIN_DISTINCT values   an entity, not a category (roles.js)
     ≥ SAME_TARGET_MIN_ROWS rows in repeated groups   the presence-signal bar
     (same − overall) / (1 − overall) ≥ SAME_TARGET_MIN   same target far beyond the
         most common value's own rate, so a dominant class cannot pass on its own
   "Overall" is the most common target value's share among the rows where the column is
   RECORDED: events.csv's player_in exists only on substitutions, where no goal is ever
   scored, and against the whole file it read as 100% "same target" — a fact about which
   rows carry the column, which presence signals already measure, not about an entity.
   Measured 2026-09-22 over the 40 test files that have a target: those three, nothing else.
   Runs in the analysis worker (analyzeWithDiagnostic): 2.2 s on openpowerlifting's
   386,414 rows would otherwise freeze the page when the leakage review starts. */
export const SAME_TARGET_MIN = 0.9;
const SAME_TARGET_MIN_ROWS = 20;

export function findSameTargetValues(data, result) {
  const { meta } = result;
  const target = meta.target;
  const out = [];
  if (target && data?.length) {
    const tkey = data.map((r) => (isMissing(r[target]) ? null : normalizeValue(r[target])));

    for (const column of Object.keys(meta.columnRoles)) {
      if (column === target || meta.columnRoles[column] === ROLE.TEXT) continue;
      const overall = new Map();
      let present = 0;
      // Per value: its first target and a count; a Map of counts only once a second target appears.
      const groups = new Map();
      for (let i = 0; i < data.length; i++) {
        const v = data[i][column];
        if (tkey[i] === null || isMissing(v)) continue;
        present++;
        overall.set(tkey[i], (overall.get(tkey[i]) ?? 0) + 1);
        const key = normalizeValue(v);
        const g = groups.get(key);
        if (!g) { groups.set(key, { n: 1, first: tkey[i], counts: null }); continue; }
        g.n++;
        if (!g.counts && tkey[i] !== g.first) g.counts = new Map([[g.first, g.n - 1]]);
        if (g.counts) g.counts.set(tkey[i], (g.counts.get(tkey[i]) ?? 0) + 1);
      }
      if (groups.size <= ENTITY_KEY_MIN_DISTINCT) continue;
      let top = 0;
      for (const c of overall.values()) top = Math.max(top, c);
      const base = top / present;
      if (base === 1) continue;
      let repeated = 0, same = 0;
      for (const g of groups.values()) {
        if (g.n < 2) continue;
        repeated += g.n;
        if (!g.counts) { same += g.n; continue; }
        let mode = 0;
        for (const c of g.counts.values()) mode = Math.max(mode, c);
        same += mode;
      }
      if (repeated < SAME_TARGET_MIN_ROWS) continue;
      const share = same / repeated;
      if ((share - base) / (1 - base) < SAME_TARGET_MIN) continue;
      out.push({ column, values: groups.size, repeatedRows: repeated, sameTargetShare: sig(share), overallShare: sig(base) });
    }
  }
  return out;
}
