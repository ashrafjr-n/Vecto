/* ─────────────────────────────────────────────
   Datassert CSV ANALYZER — Entry Point (V3)
   Pure JavaScript · No AI · No external APIs
───────────────────────────────────────────── */

import { detectColumnRoles }       from "./detectors/roles.js";
import { getQuality }              from "./analyzers/quality.js";
import { getStatistics,
         getVisualizations }       from "./analyzers/stats.js";
import { getRelationshipsV3 }      from "./analyzers/relations.js";
import { getHealthScore }          from "./scoring/health.js";
import { getRecommendations }      from "./intelligence/recommendations.js";
import { getPriorityInsights }     from "./intelligence/insights.js";
import { getValues, isMissing, valueFrequencies, isIdentifierCol } from "./helpers.js";
import { ROLE } from "./roles.constants.js";

export { detectColumnRoles }       from "./detectors/roles.js";
export { detectTarget }            from "./detectors/target.js";

/* The phases, in the order they run, with the label the UI shows. Exported so the
   processing screen can say "3 of 6" without hardcoding a count that would go
   stale the moment a phase is added. */
export const ANALYSIS_PHASES = [
  { id: "roles",           label: "Classifying columns" },
  { id: "quality",         label: "Checking data quality" },
  { id: "statistics",      label: "Computing statistics" },
  { id: "visualizations",  label: "Building distributions" },
  { id: "relationships",   label: "Measuring relationships" },
  { id: "scoring",         label: "Scoring and writing recommendations" },
];

/* `onPhase` announces which phase is starting. It is optional and defaults to a
   no-op, so the engine stays a pure function of its inputs — the result does not
   depend on it and nothing here reads anything back.

   It exists because the work is real: 386,414 rows x 17 columns is ~18 seconds,
   and the processing screen was a bare spinner for all of it. frontend.md rules
   out a fake percentage and fake-progress theatre, which this is not — every
   label below is the phase actually executing when it is shown. */
export function analyzeDataset(data, columns, target, onPhase = () => {}) {
  const phase = (i) => onPhase({ ...ANALYSIS_PHASES[i], index: i, total: ANALYSIS_PHASES.length });

  phase(0);
  const columnRoles     = detectColumnRoles(data, columns, target);
  const identifierCols  = columns.filter(c => columnRoles[c] === ROLE.IDENTIFIER);
  const temporalCols    = columns.filter(c => columnRoles[c] === ROLE.TEMPORAL);
  const textCols        = columns.filter(c => columnRoles[c] === ROLE.TEXT);
  // Exclude target from feature lists — it's tracked separately via meta.target
  const numericCols     = columns.filter(c => columnRoles[c] === ROLE.NUMERIC
                            && c !== target);
  const categoricalCols = columns.filter(c =>
                            (columnRoles[c] === ROLE.CATEGORICAL || columnRoles[c] === ROLE.BINARY)
                            && c !== target);

  // Non-feature columns skipped by the target-correlation scan (relations.js re-derives
  // types from raw values, ignoring roles — so identifiers AND temporals must be named
  // explicitly there or they leak back in as spurious predictors).
  /* A Map, not a Set, so the scan can say WHY a column was left out instead of
     just leaving it out. Map answers .has() exactly as the Set did, so callers
     that only ask membership are unaffected. */
  const skipFromCorrelation = new Map([
    ...identifierCols.map(c => [c, `"${c}" is an identifier — one value per row identifies the row, not a property of it, so any association with the target would be memorisation.`]),
    ...temporalCols.map(c => [c, `"${c}" is a date. Correlating a raw timestamp against the target measures drift over the collection period, not a feature; derive a part of it (month, weekday, age-at-event) and scan that instead.`]),
    ...textCols.map(c => [c, `"${c}" is free text, not a category. Its values are sentences, so an association measure over them describes the wording rather than a variable; extract features from it (length, keywords, embeddings) and scan those.`]),
  ]);

  /* detectColumnRoles deliberately skips the identifier check for the target, so
     the target's identifier-ness is not recoverable from columnRoles or from
     identifierCols. It has to be asked separately — without it, PassengerId as a
     target looks exactly like a legitimate continuous regression target (a price
     column is ALSO one distinct value per row) and scored 88 "Good". */
  const targetIsIdentifier = !!target && isIdentifierCol(data, target);

  const meta           = getMeta(data, columns, target, numericCols, categoricalCols, identifierCols, temporalCols, textCols, columnRoles, targetIsIdentifier);
  phase(1);
  const quality        = getQuality(data, columns, identifierCols, temporalCols, textCols);
  phase(2);
  const statistics     = getStatistics(data, numericCols);
  phase(3);
  // statistics first — getVisualizations reads its rows instead of recomputing them.
  const visualizations = getVisualizations(data, columns, numericCols, categoricalCols, statistics);
  phase(4);
  const relationships  = getRelationshipsV3(data, numericCols, target, skipFromCorrelation, categoricalCols);
  const classBalance   = getClassBalance(data, target);
  const snapshot       = getDatasetSnapshot(data, columns);

  phase(5);
  // V3 systems
  const healthScore       = getHealthScore({ meta, quality, statistics, relationships, classBalance });
  const recommendations   = getRecommendations({ meta, quality, statistics, relationships, classBalance, visualizations });
  const insights          = getPriorityInsights({ meta, quality, statistics, relationships, classBalance, recommendations });

  return {
    meta, quality, statistics, visualizations,
    relationships, classBalance, snapshot,
    insights, healthScore, recommendations,
  };
}


function getMeta(data, columns, target, numericCols, categoricalCols, identifierCols, temporalCols, textCols, columnRoles, targetIsIdentifier) {
  let datasetType = "Unknown";

  if (target) {
    // FIX #2: Use column role as primary signal — more reliable than unique count
    const targetRole = columnRoles[target];

    if (targetRole === ROLE.NUMERIC) {
      // Numeric role means values are continuous measurements → Regression
      datasetType = "Regression";
    } else if (targetRole === ROLE.BINARY) {
      // Exactly 2 values (0/1, yes/no) → Binary Classification
      datasetType = "Classification";
    } else if (targetRole === ROLE.CATEGORICAL) {
      // Multiple text/category values → Multi-class Classification
      datasetType = "Classification";
    } else if (targetRole === ROLE.TEMPORAL) {
      // Date/datetime target — forecasting problem. (Full temporal-target handling
      // is a later step; here we just avoid mislabeling it Regression/Classification.)
      datasetType = "Time Series";
    } else {
      // target role = "target" (assigned by detectColumnRoles as fallback)
      // Fall back to unique count heuristic
      const vals   = getValues(data, target);
      const unique = [...new Set(vals)];
      datasetType  = unique.length <= 10 ? "Classification" : "Regression";
    }
  }

  return {
    rows:            data.length,
    columns:         columns.length,
    numericCols,
    categoricalCols,
    identifierCols,
    temporalCols,
    textCols,
    columnRoles,
    target,
    targetIsIdentifier,
    datasetType,
  };
}


function getClassBalance(data, target) {
  if (!target) return null;

  const allVals     = data.map(r => r[target]);
  const totalRows   = allVals.length;
  const missingCount = allVals.filter(v => isMissing(v)).length;

  // Levels are grouped by the canonical key and labelled with an original
  // spelling, so " Male "/"MALE"/"male" is ONE class still displayed as "Male".
  // FIX: pct over totalRows (not just non-missing), so numbers add up to ≤100%
  const classes = valueFrequencies(data, target).map(({ value, count }) => ({
    value,
    count,
    pct: Math.round((count / totalRows) * 1000) / 10,
  }));

  if (missingCount > 0) {
    classes.push({
      value:   "(missing)",
      count:   missingCount,
      pct:     Math.round((missingCount / totalRows) * 1000) / 10,
      missing: true,
    });
  }

  const nonMissing   = classes.filter(c => !c.missing);
  const maxPct       = nonMissing[0]?.pct ?? 0;
  const minPct       = nonMissing[nonMissing.length - 1]?.pct ?? 0;

  // FIX P9: use majority/minority ratio instead of just majority threshold.
  // Handles multi-class imbalance (e.g. 60/20/20 is imbalanced even though 60 < 70).
  // Ratio > 3 means the largest class is 3× the smallest — clearly imbalanced.
  const imbalanceRatio = minPct > 0 ? maxPct / minPct : Infinity;
  const isImbalanced   = imbalanceRatio > 3 || maxPct > 80;

  return { classes, isImbalanced, totalRows, missingCount };
}


export function getDatasetSnapshot(data, columns) {
  const rows = data.slice(0, 10).map(row => {
    const clean = {};
    columns.forEach(col => {
      const val = row[col];
      clean[col] = val === "" || val == null ? null : val;
    });
    return clean;
  });

  return { columns, rows };
}

/* ══════════════════════════════════════════
   TOP INSIGHTS — column-aware, cross-signal
══════════════════════════════════════════ */

export function generateSampleData() {
  const departments = ["Engineering", "Sales", "HR", "Marketing", "Finance"];
  const educations  = ["Bachelor's", "Master's", "PhD", "High School"];
  const genders     = ["Male", "Female", "Other"];

  const rand  = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const pick  = arr => arr[Math.floor(Math.random() * arr.length)];
  const gauss = (mu, sigma) => {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  const rows = Array.from({ length: 500 }, (_, i) => {
    const age        = Math.round(Math.max(22, Math.min(58, gauss(38, 8))));
    const experience = Math.round(Math.max(1,  Math.min(25, gauss(8, 5))));
    const salary     = Math.round(Math.max(30000, Math.min(120000, gauss(65000, 18000))));
    const score      = Math.round(Math.max(1, Math.min(5, gauss(3.2, 0.8))));
    const churn      = (salary < 45000 || score < 2 || experience < 2) && Math.random() > 0.4 ? 1 : 0;

    return {
      employee_id:       i + 1,
      age,
      gender:            pick(genders),
      department:        pick(departments),
      years_experience:  experience,
      education:         pick(educations),
      salary,
      performance_score: score,
      remote_work:       rand(0, 1),
      churn,
    };
  });

  [10, 55, 120, 200, 310].forEach(idx => { rows[idx].salary = ""; });
  [30, 90].forEach(idx => { rows[idx].performance_score = ""; });

  const columns = Object.keys(rows[0]);
  return { data: rows, columns };
}

