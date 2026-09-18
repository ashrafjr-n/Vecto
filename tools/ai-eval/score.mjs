import { LEAK_CATEGORIES } from "../../src/lib/ai/leakageSchema.js";

/* Scores one verified dossier against one expectation. Pure — no I/O — so the
   scoring rule is testable on its own (tests/ai-eval-score.test.mjs).

   It scores what the USER would see: the answer after verifyDossier(), so a role
   the verifier withheld counts as missing, exactly as it would on the page. */

export function scoreDossier(expect, verified, engineTargetGuess) {
  const checks = [];
  const byName = new Map(verified.columns.map((c) => [c.name, c]));
  const add = (kind, name, ok, got, want) => checks.push({ kind, name, ok, got, want });

  if (expect.targets) {
    const picks = verified.targets.map((t) => t.column);
    add("target@1", "top suggested target", expect.targets.includes(picks[0]), picks[0] ?? null, expect.targets);
    add("target@3", "any of the top 3", picks.some((p) => expect.targets.includes(p)), picks, expect.targets);
  }
  for (const [kind, field] of [["role", "role"], ["subtype", "subtype"]]) {
    for (const [col, want] of Object.entries(expect[`${field}s`] ?? {})) {
      const got = byName.get(col)?.[field] ?? null;
      add(kind, col, want.includes(got), got, want);
    }
  }

  const passed = checks.filter((c) => c.ok).length;
  return {
    passed,
    total: checks.length,
    checks,
    // Not pass/fail — the shape of the answer, reported beside the score.
    hygiene: {
      described: verified.columns.length,
      undescribed: verified.undescribed.length,
      withheld: verified.withheld.length,
      contradictedRoles: verified.columns.filter((c) => c.roleContradiction).length,
      roleChangesOffered: verified.columns.filter((c) => !c.agrees && !c.roleContradiction).length,
    },
    // Does the model beat the engine's own guess? Only meaningful when a target exists.
    engineTargetOk: expect.targets ? expect.targets.includes(engineTargetGuess) : null,
  };
}

/* Scores one verified leakage review. A leak counts as found only if the model
   raised it in an acceptable category AND it survived verification — a finding
   the verifier withheld is not on the page. A clean column counts as clean only
   if it was not raised at all, in any category: flagging a real predictor as
   leakage is the failure that would do the most damage, because a user would
   drop a good feature on the model's word. */
/* A LEAKAGE category is an accusation: it says a column cannot be used at prediction
   time. A RELEVANCE category (vecto-plan item 31) is the opposite kind of statement —
   it says a column's statistics and its meaning disagree, and it is always rendered as
   a question. Scoring them together would make every relevance remark on a legitimate
   predictor read as a false accusation and sink "clean columns left alone", which is
   the one metric that has never failed. They are split here BEFORE item 31 adds the
   categories, so the bar cannot move under the change it was meant to measure. */
const isLeak = (category) => LEAK_CATEGORIES.includes(category);

export function scoreLeakage(expect, verified) {
  const checks = [];
  const add = (kind, name, ok, got, want) => checks.push({ kind, name, ok, got, want });
  const categoriesOn = (col, keep) =>
    verified.findings.filter((f) => f.column === col && keep(f.category)).map((f) => f.category);
  const raised = (col) => categoriesOn(col, isLeak);
  const relevanceOn = (col) => categoriesOn(col, (c) => !isLeak(c));

  for (const [col, want] of Object.entries(expect.leaks ?? {})) {
    const got = raised(col);
    add("leak", col, got.some((c) => want.includes(c)), got, want);
  }
  for (const col of expect.clean ?? []) {
    const got = raised(col);
    add("clean", col, got.length === 0, got, ["(not raised)"]);
  }
  /* Relevance is scored on its own axis: a column here is a legitimate predictor whose
     numbers understate it (or the reverse), so the answer wanted is a relevance remark,
     never a leak category. Absent until item 31 ships the categories, at which point
     these checks start counting without the leak bars moving. */
  for (const [col, want] of Object.entries(expect.relevance ?? {})) {
    const got = relevanceOn(col);
    add("relevance", col, got.some((c) => want.includes(c)), got, want);
  }
  if (expect.split) {
    const got = verified.split?.strategy ?? null;
    add("split", "split strategy", expect.split.includes(got), got, expect.split);
  }

  const verdicts = {};
  for (const f of verified.findings) verdicts[f.verdict] = (verdicts[f.verdict] ?? 0) + 1;

  /* Findings on columns the expectations never labelled. They are NOT scored — writing an
     expectation after reading an answer is fitting the labels to the model — but they are
     listed, because "legitimate predictors left alone" only ever counted LABELLED clean
     columns, so a false accusation on an unlabelled column scored nothing at all. Day 2
     hid four that way (diamonds x/y/z, ai_student Pre_Semester_GPA). Read them by hand. */
  const labelled = new Set([
    ...Object.keys(expect.leaks ?? {}), ...(expect.clean ?? []), ...Object.keys(expect.relevance ?? {}),
  ]);
  const unchecked = verified.findings
    .filter((f) => !labelled.has(f.column))
    .map((f) => ({ column: f.column, category: f.category, verdict: f.verdict, leak: isLeak(f.category) }));

  return {
    passed: checks.filter((c) => c.ok).length,
    total: checks.length,
    checks,
    unchecked,
    hygiene: {
      findings: verified.findings.length,
      // Split so item 31's categories cannot be mistaken for a rise in accusations.
      leakFindings: verified.findings.filter((f) => isLeak(f.category)).length,
      relevanceFindings: verified.findings.filter((f) => !isLeak(f.category)).length,
      withheld: verified.withheld.length,
      engineOnly: verified.engineOnly.length,
      unchecked: unchecked.length,
      verdicts,
    },
  };
}

/* Scores one verified cleaning proposal. Only EFFECTIVE rules count — a rule that
   changes no value is never offered on the page. Factors are checked within 2%,
   and a unit ladder by ratio, because the model may pick any unit as the base. */
export function scoreCleaning(expect, verified) {
  const checks = [];
  const add = (kind, name, ok, got, want) => checks.push({ kind, name, ok, got, want });
  const near = (a, b) => Number.isFinite(a) && Math.abs(a - b) <= 0.02 * Math.abs(b);
  const effective = verified.rules.filter((r) => r.effective);

  for (const e of expect.rules ?? []) {
    const rule = effective.find((r) => r.column === e.column && e.types.includes(r.type));
    add("rule", e.column, !!rule, rule?.type ?? null, e.types);
    if (!rule) continue;
    const factor = new Map(rule.affixes.map((a) => [a.affix, a.factor]));
    for (const [affix, want] of Object.entries(e.factors ?? {})) {
      add("factor", `${e.column} "${affix}"`, near(factor.get(affix), want), factor.get(affix) ?? null, [want]);
    }
    for (const [affix, base, ratio] of e.ratios ?? []) {
      const got = factor.has(affix) && factor.has(base) ? factor.get(affix) / factor.get(base) : null;
      add("factor", `${e.column} "${affix}"/"${base}"`, near(got, ratio), got, [ratio]);
    }
    for (const affix of e.affixes ?? []) {
      add("factor", `${e.column} covers "${affix}"`, factor.has(affix), [...factor.keys()], [affix]);
    }
  }
  // A file expected to need nothing must get nothing that changes values. Only an explicit
  // `rules: []` says that; an entry with just `forbidden` leaves other rules unscored.
  if (Array.isArray(expect.rules) && expect.rules.length === 0) add("quiet", "no rule proposed", effective.length === 0, effective.map((r) => r.column), ["(none)"]);
  for (const [column, types] of Object.entries(expect.forbidden ?? {})) {
    const hit = effective.find((r) => r.column === column && types.includes(r.type));
    add("declined", column, !hit, hit?.type ?? null, ["(not proposed)"]);
  }

  return {
    passed: checks.filter((c) => c.ok).length,
    total: checks.length,
    checks,
    hygiene: { rules: verified.rules.length, effective: effective.length, withheld: verified.withheld.length },
  };
}
