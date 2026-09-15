/* Blind labelling sheet (vecto-plan.md item 17) — tests the EVAL, not the model.

   The prompt, the expectations and the scorer were written by the same author, so a
   99% may mean an easy exam. This picks a random, stratified sample of columns from
   the dossier corpus and writes a sheet the owner fills in WITHOUT seeing the engine's
   role, the model's answer or the expectations. tools/blind-agreement.mjs then compares.

   Stratified so the sample is not all easy columns: half comes from columns the
   expectations name (so owner-vs-expectations has overlap), and inside each half the
   picks rotate through strata — each engine role, plus an "ambiguous" stratum (small
   integer ranges, partly numeric text, two-valued numbers) taken first, at most
   AMBIGUOUS_PER_FILE from one file. Seeded, so the same command always gives the same sample.

   Left out, because no label from them measures anything:
   - a headerless file (most column names are numbers — sonar's first data row became
     its header), where there is no name to judge from;
   - a column name already sampled from a sibling file — one in the same folder sharing
     ≥ 80% of its columns, like a train/test pair: that is one dataset, and the same
     column labelled twice counts one judgement twice.

   Writes forTesting/blind/sheet.html and forTesting/blind/sample.json (gitignored).
   Usage: node --max-old-space-size=8192 tools/blind-sample.mjs [--size=60] [--seed=17] */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import Papa from "papaparse";

import { detectColumnRoles } from "../src/components/utils/core/index.js";
import { transformHeader } from "../src/lib/csvIntake.js";
import { isNumeric } from "../src/components/utils/core/helpers.js";
import { buildDossierPayload } from "../src/lib/ai/dossier.js";
import { DOSSIER_ROLES, DOSSIER_SUBTYPES } from "../src/lib/ai/dossierSchema.js";
import { EXPECTATIONS } from "./ai-eval/expectations.mjs";

const flag = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const SIZE = Number(flag("size") ?? 60);
const SEED = Number(flag("seed") ?? 17);
const PER_FILE_CAP = 6;
const AMBIGUOUS_PER_FILE = 2;
const OUT = "forTesting/blind";

// mulberry32 — a small seeded generator, so the sample is reproducible.
let state = SEED >>> 0;
const random = () => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const shuffle = (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const ambiguous = (p) =>
  (p.allIntegers && p.numericShare === 1 && typeof p.distinct === "number" && p.distinct <= 25)
  || (p.numericShare >= 0.5 && p.numericShare < 0.95)
  || (p.distinct === 2 && p.numericShare === 1);

const files = [];
const pool = [];
for (const e of EXPECTATIONS) {
  const path = join("forTesting", e.file);
  if (!existsSync(path)) { console.log(`${e.file}: MISSING FILE, skipped`); continue; }
  const parsed = Papa.parse(readFileSync(path, "utf8"), { header: true, skipEmptyLines: true, transformHeader });
  const columns = parsed.meta.fields;
  if (columns.filter((c) => isNumeric(c)).length > columns.length / 2) {
    console.log(`${e.file}: headerless (column names are data), skipped`);
    continue;
  }
  const roles = detectColumnRoles(parsed.data, columns, null);
  const payload = buildDossierPayload(parsed.data, columns, roles);
  const named = new Set([...Object.keys(e.roles ?? {}), ...Object.keys(e.subtypes ?? {})]);
  const dir = e.file.includes("/") ? e.file.slice(0, e.file.lastIndexOf("/")) : "";
  const sibling = files.find((f) => f.dir === dir && columns.filter((c) => f.columns.includes(c)).length >= 0.8 * columns.length);
  const dataset = sibling?.dataset ?? e.file;
  files.push({ file: e.file, dir, dataset, rows: parsed.data.length, columns });
  for (const profile of payload.columns) {
    const { engineRole, ...shown } = profile;   // never shown to the labeller
    pool.push({
      file: e.file,
      dataset,
      column: profile.name,
      named: named.has(profile.name),
      stratum: ambiguous(profile) ? "ambiguous" : engineRole,
      profile: shown,
    });
  }
  console.log(`${e.file}: ${columns.length} columns`);
}

const perFile = new Map();
const ambiguousPerFile = new Map();
const sampledNames = new Set();   // "dataset::column"
function take(candidates, quota) {
  const strata = new Map();
  for (const c of shuffle(candidates)) {
    if (!strata.has(c.stratum)) strata.set(c.stratum, []);
    strata.get(c.stratum).push(c);
  }
  // "ambiguous" leads the rotation; the rest in a fixed order.
  const order = [...strata.keys()].sort((a, b) => (a === "ambiguous" ? -1 : b === "ambiguous" ? 1 : a.localeCompare(b)));
  const picked = [];
  while (picked.length < quota && order.some((k) => strata.get(k).length)) {
    for (const k of order) {
      if (picked.length === quota) break;
      const list = strata.get(k);
      while (list.length) {
        const c = list.shift();
        if ((perFile.get(c.file) ?? 0) >= PER_FILE_CAP) continue;
        if (c.stratum === "ambiguous" && (ambiguousPerFile.get(c.file) ?? 0) >= AMBIGUOUS_PER_FILE) continue;
        const nameKey = `${c.dataset}::${c.column}`;
        if (sampledNames.has(nameKey)) continue;
        sampledNames.add(nameKey);
        perFile.set(c.file, (perFile.get(c.file) ?? 0) + 1);
        if (c.stratum === "ambiguous") ambiguousPerFile.set(c.file, (ambiguousPerFile.get(c.file) ?? 0) + 1);
        picked.push(c);
        break;
      }
    }
  }
  return picked;
}

const half = Math.ceil(SIZE / 2);
const sample = [...take(pool.filter((c) => c.named), half), ...take(pool.filter((c) => !c.named), SIZE - half)];
// Present in file order so the labeller reads one dataset at a time — but never grouped by stratum.
sample.sort((a, b) => files.findIndex((f) => f.file === a.file) - files.findIndex((f) => f.file === b.file) || random() - 0.5);

mkdirSync(OUT, { recursive: true });
const sheetData = {
  seed: SEED,
  roles: DOSSIER_ROLES,
  subtypes: DOSSIER_SUBTYPES,
  files: files.map(({ file, rows, columns }) => ({ file, rows, columns, items: sample.filter((s) => s.file === file).map((s) => ({ column: s.column, profile: s.profile })) })),
};
writeFileSync(join(OUT, "sample.json"), JSON.stringify({
  seed: SEED,
  columns: sample.map(({ file, column, named, stratum }) => ({ file, column, named, stratum })),
}, null, 2));
writeFileSync(join(OUT, "sheet.html"), readFileSync("tools/blind-sheet.html", "utf8").replace("const DATA = __DATA__;", () => `const DATA = ${JSON.stringify(sheetData).replace(/</g, "\\u003c")};`));

const count = (key) => Object.entries(sample.reduce((m, s) => ({ ...m, [s[key]]: (m[s[key]] ?? 0) + 1 }), {})).map(([k, v]) => `${k} ${v}`).join(", ");
console.log(`\n${sample.length} columns from ${files.length} files · strata: ${count("stratum")} · named in expectations: ${sample.filter((s) => s.named).length}`);
console.log(`→ ${join(OUT, "sheet.html")}`);
