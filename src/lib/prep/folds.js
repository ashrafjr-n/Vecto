/* Which rows go where — decided BEFORE anything is learned from them.

   assignFolds() gives every row a fold number 0 … k−1. A train/test split is
   fold 0 of k = 5 held out (20%); cross-validation holds out each fold in turn.
   One function for both, so a split and a CV run can never disagree on what a
   group or a stratum means.

   Deterministic: a seeded shuffle, never Math.random, so the same file gives the
   same folds on every run and the report's numbers do not move between reloads. */

/* Small seeded PRNG (mulberry32) — enough for a shuffle, not for cryptography. */
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, random) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/* Rows grouped by a key, keys in first-seen order. */
function groupRows(n, keyOf) {
  const byKey = new Map();
  for (let i = 0; i < n; i++) {
    const key = keyOf(i);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(i);
  }
  return [...byKey.values()];
}

/* n rows → Uint8Array of fold numbers.
     groups — row → group key; every row of a group lands in ONE fold, so an
              entity is never on both sides. Groups go largest first to the
              lightest fold (scikit-learn's GroupKFold does the same), after a
              seeded shuffle so equal sizes are not ordered by the file.
              A null/undefined key is a group of its own.
     strata — row → class key; each class is dealt round-robin across the folds,
              so every fold keeps the class shares (StratifiedKFold's idea).
   groups wins over strata: keeping an entity on one side matters more than
   exact class shares, and the two cannot both be guaranteed. */
export function assignFolds(n, k, { groups = null, strata = null, seed = 42 } = {}) {
  const random = seededRandom(seed);
  const folds = new Uint8Array(n);

  if (groups) {
    const lists = shuffle(groupRows(n, i => groups(i) ?? `\u0000row${i}`), random)
      .sort((a, b) => b.length - a.length);           // stable: ties keep the shuffled order
    const load = new Array(k).fill(0);
    for (const rows of lists) {
      let lightest = 0;
      for (let f = 1; f < k; f++) if (load[f] < load[lightest]) lightest = f;
      for (const i of rows) folds[i] = lightest;
      load[lightest] += rows.length;
    }
    return folds;
  }

  const lists = strata ? groupRows(n, strata) : [Array.from({ length: n }, (_, i) => i)];
  let offset = 0;                                       // carried across classes so fold sizes stay even
  for (const rows of lists) {
    shuffle(rows, random).forEach((i, r) => { folds[i] = (offset + r) % k; });
    offset = (offset + rows.length) % k;
  }
  return folds;
}
