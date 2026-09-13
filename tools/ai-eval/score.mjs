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
