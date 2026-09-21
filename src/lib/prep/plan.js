/* The preparation plan — what a training pipeline does with each column, read
   from the finished analysis. Pure, and deliberately OUTSIDE the engine: the
   engine describes the data; this turns its decisions into steps.

   Every choice here is one the report already made, read through the engine's
   own exports — never a second judgement that could disagree with the advice:
     identifier / empty / constant / leaking / replaced → columnDecisions()
     mean vs median vs most frequent                    → imputeStrategy()
     a "_was_missing" indicator beside the value         → IMPUTE_FLAG_PCT
     too fine to learn from, so group the split by it    → columnDeterminations()

   → { usable: false, reason } or
     { usable: true, target, task: "classification" | "regression",
       numeric:     [{ col, impute: "mean" | "median" | "most_frequent", flag }],
       categorical: [{ col, flag }],
       presence:    [col],                  // only whether it was recorded is kept
       excluded:    [{ col, reason }],
       groupBy, stratify, dropDuplicates } */

import { ROLE } from "../../components/utils/core/roles.constants.js";
import { sharePct } from "../../components/utils/core/helpers.js";
import {
  columnDecisions, imputeStrategy, columnDeterminations, IMPUTE_FLAG_PCT, TOO_FINE_ROWS_PER_LEVEL,
} from "../../components/utils/core/intelligence/recommendations.js";

const TASK = { Classification: "classification", Regression: "regression" };
const FEATURE_ROLES = new Set([ROLE.NUMERIC, ROLE.BINARY, ROLE.CATEGORICAL]);

const REASON = {
  identifier: "identifier — a model memorises which row it is, not why",
  dropped:    "empty or constant — nothing to learn from",
  leaking:    "suspected target leakage — add it back only if it is known before the outcome",
  temporal:   "date — extract the parts that matter (year, month, time elapsed) yourself; the pipeline does not guess which",
  text:       "free text — needs its own encoding (TF-IDF, embeddings)",
};

export function buildPrepPlan({ meta, quality, statistics, relationships, classBalance }) {
  const target = meta.target;
  if (!target) return { usable: false, reason: "No target is set, so there is nothing to split or predict." };
  if (meta.targetIsConstant) return { usable: false, reason: `"${target}" never varies, so there is nothing to predict.` };
  if (meta.targetIsIdentifier) return { usable: false, reason: `"${target}" is an identifier — one value per row is nothing a model can learn.` };
  const task = TASK[meta.datasetType];
  if (!task || !FEATURE_ROLES.has(meta.columnRoles[target])) {
    return { usable: false, reason: `A ${meta.datasetType === "Time Series" ? "date" : "text"} target is outside what this pipeline builds.` };
  }

  const { dropped, replaced, leaking, notKept } = columnDecisions({ meta, quality, relationships });
  const identifiers = new Set(meta.identifierCols);
  const missing = new Map(quality.columnsWithIssues.filter(c => c.issue === "missing").map(c => [c.col, c.count]));
  const flagged = (col) => sharePct(missing.get(col) ?? 0, meta.rows) > IMPUTE_FLAG_PCT;

  /* The advice says a column this fine is to be used only to group the split. */
  const bothKept = (a, b) => !notKept.has(a) && !notKept.has(b);
  const tooFine = [...columnDeterminations(relationships.categoricalAssociations, bothKept)]
    .filter(([, d]) => d.rows / d.levels < TOO_FINE_ROWS_PER_LEVEL)
    .sort(([, a], [, b]) => b.levels - a.levels);
  const tooFineCols = new Map(tooFine);

  const plan = {
    usable: true, target, task,
    numeric: [], categorical: [], presence: [], excluded: [],
    // ponytail: one grouping column; with several too-fine columns the finest is used and the rest stay excluded.
    groupBy: tooFine[0]?.[0] ?? null,
    stratify: false,
    dropDuplicates: (quality.duplicateRows ?? 0) > 0,
  };

  for (const col of Object.keys(meta.columnRoles)) {
    if (col === target) continue;
    const role = meta.columnRoles[col];
    const exclude = (reason) => plan.excluded.push({ col, reason });

    if (identifiers.has(col))          exclude(REASON.identifier);
    else if (leaking.has(col))         exclude(REASON.leaking);
    else if (dropped.has(col))         exclude(REASON.dropped);
    else if (replaced.has(col))        plan.presence.push(col);
    else if (role === ROLE.TEMPORAL)   exclude(REASON.temporal);
    else if (role === ROLE.TEXT)       exclude(REASON.text);
    else if (tooFineCols.has(col)) {
      const d = tooFineCols.get(col);
      exclude(`too fine to learn from (~${(d.rows / d.levels).toFixed(1)} rows per level)`
        + (col === plan.groupBy ? " — used to group the split instead" : ""));
    }
    else if (role === ROLE.NUMERIC) {
      const stat = statistics.find(s => s.col === col);
      plan.numeric.push({ col, impute: imputeStrategy(role, stat), flag: flagged(col) });
    }
    else if (role === ROLE.CATEGORICAL || role === ROLE.BINARY) {
      plan.categorical.push({ col, flag: flagged(col) });
    }
  }

  /* Stratify only when every class can sit on both sides; a grouped split cannot
     also stratify, and keeping an entity on one side matters more. */
  plan.stratify = task === "classification" && !plan.groupBy
    && (classBalance?.classes ?? []).every(c => c.count >= 2);
  return plan;
}
