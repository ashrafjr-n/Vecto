/* The readiness checklist — the report's findings turned into one answer: can this
   file be trained on as it stands, and if not, what comes first?

   Pure, and outside the engine like the plan and the diagnostic: it measures nothing.
   Every item reads a finding another section already made, and names the section
   that holds the evidence, so the checklist can never say something the report does
   not. Three levels:
     blocker  training now would give a misleading model or score
     fix      training works, but the result is weaker or optimistic until it is dealt with
     note     worth knowing; nothing to do, or the preparation plan already does it

   → { verdict: "blocked" | "fix" | "ready" | "no_target", items: [{ level, title, detail, tab }] } */

import { buildPrepPlan } from "./prep/plan.js";
import { PERSONAL_LABEL } from "../components/utils/core/detectors/personal.js";

/* A class with fewer rows than this cannot be learned or validated: five folds leave
   it one or two rows per test fold. */
export const MIN_CLASS_ROWS = 10;
export const MIN_ROWS = 50;
export const SMALL_ROWS = 200;
export const MOSTLY_MISSING_PCT = 50;
/* Conflicting labels on this share of rows or more cap what any model can score. */
export const CONFLICT_BLOCK_PCT = 5;

const LEVEL_ORDER = { blocker: 0, fix: 1, note: 2 };
const quote = (cols, max = 3) => {
  const shown = cols.slice(0, max).map(c => `"${c}"`).join(", ");
  return cols.length > max ? `${shown} and ${cols.length - max} more` : shown;
};
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const fmt = (x) => (Number.isFinite(x) ? x.toFixed(3) : "—");

export function buildReadiness(result) {
  if (!result) return null;
  const { meta, quality, relationships, classBalance, diagnostic } = result;
  const items = [];
  const add = (level, title, detail, tab) => items.push({ level, title, detail, tab });
  const issues = quality?.columnsWithIssues ?? [];
  const ofKind = (kind) => issues.filter(c => c.issue === kind);

  /* ── the target ── */
  if (!meta.target) {
    add("note", "No target chosen",
      "Readiness is judged against what you want to predict. Choose a target to see whether this file can train it.", null);
    return { verdict: "no_target", items };
  }
  if (meta.targetIsConstant || meta.targetIsIdentifier) {
    add("blocker", `"${meta.target}" cannot be predicted`,
      meta.targetIsConstant
        ? "It has the same value on every row, so there is nothing to learn. Choose a different target."
        : "It is unique per row — an identifier, not a label. Choose a different target.", null);
    return { verdict: "blocked", items };
  }

  if (meta.rows < MIN_ROWS) {
    add("blocker", `Only ${plural(meta.rows, "row")}`,
      "Too few to train on and hold rows out for testing — any score from this file would be noise.", "quality");
  } else if (meta.rows < SMALL_ROWS) {
    add("fix", `A small dataset: ${plural(meta.rows, "row")}`,
      "Scores will move a lot between splits. Use cross-validation rather than one train/test split, and keep the model simple.", "preparation");
  }

  const targetMissing = issues.find(c => c.issue === "missing" && c.col === meta.target);
  if (targetMissing) {
    add("fix", `${plural(targetMissing.count, "row")} without a target`,
      `"${meta.target}" is empty on these rows, so they cannot be used to train or to test. The preparation plan drops them.`, "quality");
  }

  /* ── leakage: the one finding that makes every other number optimistic ── */
  const leaks = (relationships?.leakageSuspects ?? []).map(l => l.col);
  if (leaks.length) {
    add("blocker", `Possible target leakage in ${quote(leaks)}`,
      `${leaks.length === 1 ? "This column determines" : "These columns determine"} the target almost completely. If ${leaks.length === 1 ? "it is" : "they are"} recorded at or after the outcome, a model trained on ${leaks.length === 1 ? "it" : "them"} looks excellent and fails in use. Confirm ${leaks.length === 1 ? "it is" : "each is"} known before the outcome; the plan leaves ${leaks.length === 1 ? "it" : "them"} out until then.`,
      "targetsignal");
  }
  const suspicious = (diagnostic?.status === "ok" ? diagnostic.suspicious ?? [] : []).filter(c => !leaks.includes(c));
  if (suspicious.length) {
    add("blocker", `${quote(suspicious)} alone predict${suspicious.length === 1 ? "s" : ""} the target almost perfectly`,
      "One column scoring this high on its own is more often a leak than an easy problem. Check it is known before the outcome.",
      "preparation");
  } else if (diagnostic?.status === "ok" && diagnostic.nearPerfect && !leaks.length) {
    add("blocker", "The baseline model is almost perfect",
      "An untuned linear model this accurate usually means the target is leaking through one or more columns.", "preparation");
  }

  /* ── classes ── */
  if (classBalance) {
    const present = classBalance.classes.filter(c => !c.missing);
    const rare = present.filter(c => c.count < MIN_CLASS_ROWS);
    if (rare.length) {
      add("blocker", `${rare.length === 1 ? "A class has" : `${rare.length} classes have`} fewer than ${MIN_CLASS_ROWS} rows`,
        `${rare.slice(0, 3).map(c => `"${c.value}" (${c.count})`).join(", ")} — too few to learn or to test. Collect more rows, merge the class into a neighbour, or drop it.`,
        "classbalance");
    } else if (classBalance.isImbalanced) {
      add("fix", `Imbalanced classes: "${present[0]?.value}" is ${present[0]?.pct}% of rows`,
        "Accuracy will look high for a model that ignores the smaller classes. Train with class weights and judge it on balanced accuracy, F1 or PR-AUC.",
        "classbalance");
    }
  }

  /* ── signal ── */
  if (diagnostic?.status === "ok" && !diagnostic.unstable) {
    const metric = diagnostic.metric === "balanced_accuracy" ? "balanced accuracy" : "R²";
    if (diagnostic.signal === false) {
      add("fix", "No reliable signal found",
        `A simple model does not beat a know-nothing guess (${fmt(diagnostic.model.mean)} against ${fmt(diagnostic.baseline.mean)} in ${metric}). Expect a weak model; the columns may need better features, or may not predict "${meta.target}" at all.`,
        "preparation");
    } else if (diagnostic.signal) {
      add("note", "The columns carry signal",
        `A simple model beats a know-nothing guess: ${fmt(diagnostic.model.mean)} against ${fmt(diagnostic.baseline.mean)} in ${metric}, consistently across 5 folds. A floor, not a forecast.`,
        "preparation");
    }
  }

  /* ── splitting ── */
  const plan = buildPrepPlan(result);
  const entities = (result.sameTargetValues ?? []).map(s => s.column).filter(c => !leaks.includes(c));
  if (entities.length) {
    add("fix", `Rows repeat by ${quote(entities)}`,
      `Rows sharing a value of ${entities.length === 1 ? "this column" : "these columns"} almost always share the target. A random split puts the same entity in train and test, and the score overstates how the model does on new ones — split by group${plan.usable && plan.groupBy ? ` (the plan groups by "${plan.groupBy}")` : ""}.`,
      "preparation");
  }
  if (quality.duplicateRows > 0) {
    add("fix", plural(quality.duplicateRows, "duplicate row"),
      "A duplicate can land in train and test at once and inflate the score. The preparation plan drops them before splitting.", "quality");
  }
  const repeats = result.duplicates;
  if (repeats?.idOnlyRows > 0) {
    add("fix", `${plural(repeats.idOnlyRows, "record")} repeated under a different id`,
      `These rows match an earlier row on every column except ${quote(meta.identifierCols)} — the same record entered twice. A random split can put the two copies on both sides; drop the copies or split by the record.`,
      "quality");
  }
  if (repeats?.conflicts?.groups > 0) {
    const { groups, rows } = repeats.conflicts;
    const share = (rows / meta.rows) * 100;
    add(share >= CONFLICT_BLOCK_PCT ? "blocker" : "fix",
      `${plural(rows, "row")} with identical features but different targets`,
      `${plural(groups, "group")} of rows match on every feature yet disagree on "${meta.target}" (${share < 0.1 ? "<0.1" : share.toFixed(1)}% of rows). No model can be right on both; if the labels are errors, fix them, and if they are real, the target depends on something the file does not record.`,
      "quality");
  }

  /* ── columns ── */
  const personal = ofKind("personal_data");
  if (personal.length) {
    add("fix", `Personal data in ${quote(personal.map(c => c.col))}`,
      `${personal.map(c => `"${c.col}" looks like ${PERSONAL_LABEL[c.kind]}`).join("; ")}. Drop or hash before training or sharing the file.`,
      "quality");
  }
  const mixed = ofKind("mixed_numeric");
  if (mixed.length) {
    add("fix", `Values that are not numbers in ${quote(mixed.map(c => c.col))}`,
      "They are left out of every statistic and treated as missing by the plan. If they mean something (\"125+\", \"<5\"), clean them into numbers first.",
      "quality");
  }
  const mostlyEmpty = issues
    .filter(c => c.issue === "missing" && c.col !== meta.target && !leaks.includes(c.col)
                 && (c.count / meta.rows) * 100 >= MOSTLY_MISSING_PCT)
    .map(c => c.col);
  if (mostlyEmpty.length) {
    add("fix", `Mostly empty: ${quote(mostlyEmpty)}`,
      "Half or more of the rows have no value. The plan imputes and flags them; check whether the gaps mean something before relying on them.",
      "quality");
  }

  if (plan.usable) {
    const auto = plan.excluded.filter(e => !leaks.includes(e.col)).map(e => e.col);
    if (auto.length) {
      add("note", `The plan leaves out ${plural(auto.length, "column")} automatically`,
        `${quote(auto, 5)} — identifiers, constants, dates or free text, each with its reason in the plan.`, "preparation");
    }
  }

  items.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  const verdict = items.some(i => i.level === "blocker") ? "blocked"
                : items.some(i => i.level === "fix") ? "fix" : "ready";
  return { verdict, items };
}
