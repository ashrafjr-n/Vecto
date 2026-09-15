/* Agreement between the owner's blind labels and (a) the model, (b) the expectations —
   vecto-plan.md item 17. Run only after labels.json is saved from the sheet that
   tools/blind-sample.mjs wrote.

   The model side is the day-1 dossier answer cached by tools/ai-eval.mjs
   (reports/ai-eval/<file>.json, verified) — no request is made.

   Cohen's κ for role and subtype. "not sure" and unanswered labels are left out and
   counted. An expectation accepts a SET of labels, so it agrees when the owner's label
   is in the set; for κ's chance term it is then read as the owner's label, otherwise as
   the set's first entry. Targets are not κ (the categories are a file's own columns):
   plain agreement on the top pick.

   Every figure is also split by the sampler's stratum — "ambiguous" vs the rest — and
   the share of "not sure" is reported per stratum. A κ over a sample nobody can decide
   says the sample is impossible, not that the exam is easy; the split keeps those apart.

   Usage: node tools/blind-agreement.mjs [--labels=forTesting/blind/labels.json]
   Writes reports/blind/agreement.md. */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { EXPECTATIONS } from "./ai-eval/expectations.mjs";

const flag = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const labelsPath = flag("labels") ?? "forTesting/blind/labels.json";
const sample = JSON.parse(readFileSync("forTesting/blind/sample.json", "utf8"));
const saved = JSON.parse(readFileSync(labelsPath, "utf8"));
if (saved.seed !== sample.seed) throw new Error(`labels are for seed ${saved.seed}, the sample is seed ${sample.seed}`);
const { labels } = saved;

const slug = (file) => file.replace(/\.csv$/, "").replace(/[^a-z0-9]+/gi, "_");
const modelAnswer = (file) => {
  const p = join("reports/ai-eval", `${slug(file)}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")).verified : null;
};
const expectFor = (file) => EXPECTATIONS.find((e) => e.file === file);
const usable = (v) => v && v !== "not_sure";

/* pairs: [{ owner, other }] with single labels. */
export function kappa(pairs) {
  const n = pairs.length;
  if (!n) return { n: 0, agree: 0, kappa: null };
  const agree = pairs.filter((p) => p.owner === p.other).length;
  const po = agree / n;
  const count = (key) => pairs.reduce((m, p) => m.set(p[key], (m.get(p[key]) ?? 0) + 1), new Map());
  const a = count("owner");
  const b = count("other");
  let pe = 0;
  for (const [k, v] of a) pe += (v / n) * ((b.get(k) ?? 0) / n);
  return { n, agree, kappa: pe === 1 ? 1 : (po - pe) / (1 - pe) };
}

const GROUPS = ["all", "ambiguous", "clear"];
const groupsOf = (stratum) => ["all", stratum === "ambiguous" ? "ambiguous" : "clear"];
const out = Object.fromEntries(GROUPS.map((g) => [g, { role: { model: [], expect: [] }, subtype: { model: [], expect: [] } }]));
const unsure = Object.fromEntries(GROUPS.map((g) => [g, [0, 0]]));   // [not sure or blank, fields]
const disagreements = [];

for (const { file, column, stratum } of sample.columns) {
  const groups = groupsOf(stratum);
  const model = modelAnswer(file)?.columns.find((c) => c.name === column);
  const exp = expectFor(file);
  for (const field of ["role", "subtype"]) {
    const owner = labels[`${field}::${file}::${column}`];
    for (const g of groups) unsure[g][1]++;
    if (!usable(owner)) { for (const g of groups) unsure[g][0]++; continue; }
    if (model?.[field]) {
      for (const g of groups) out[g][field].model.push({ owner, other: model[field] });
      if (owner !== model[field]) disagreements.push(`| ${file} | ${column} | ${field} | model | ${owner} | ${model[field]} |`);
    }
    const want = exp?.[`${field}s`]?.[column];
    if (want) {
      const other = want.includes(owner) ? owner : want[0];
      for (const g of groups) out[g][field].expect.push({ owner, other });
      if (other !== owner) disagreements.push(`| ${file} | ${column} | ${field} | expectations | ${owner} | ${want.join(" / ")} |`);
    }
  }
}

const targets = { model: [0, 0], expect: [0, 0] };
for (const e of EXPECTATIONS) {
  const owner = labels[`target::${e.file}`];
  if (!usable(owner)) continue;
  const noTarget = owner === "(no real target)";
  const top = modelAnswer(e.file)?.targets?.[0]?.column;
  if (top !== undefined || noTarget) {
    targets.model[1]++;
    const ok = noTarget ? top === undefined : owner === top;
    if (ok) targets.model[0]++;
    else disagreements.push(`| ${e.file} | (target) | target | model | ${owner} | ${top ?? "(none)"} |`);
  }
  targets.expect[1]++;
  const ok = noTarget ? !e.targets : (e.targets ?? []).includes(owner);
  if (ok) targets.expect[0]++;
  else disagreements.push(`| ${e.file} | (target) | target | expectations | ${owner} | ${e.targets?.join(" / ") ?? "(no real target)"} |`);
}

const fmt = (r) => (r.n ? `κ ${r.kappa.toFixed(2)} · agree ${r.agree}/${r.n} (${Math.round((100 * r.agree) / r.n)}%)` : "n/a");
const pct = ([a, n]) => (n ? `${a}/${n} (${Math.round((100 * a) / n)}%)` : "n/a");
const md = [
  `# Blind label agreement — ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
  "",
  `Sample seed ${sample.seed} · ${sample.columns.length} columns (${sample.columns.filter((c) => c.stratum === "ambiguous").length} ambiguous) · labels saved ${saved.savedAt}`,
  "",
  "| Columns | Role/subtype fields \"not sure\" or blank | Role: owner vs model | Role: owner vs expectations | Subtype: owner vs model | Subtype: owner vs expectations |",
  "| --- | --- | --- | --- | --- | --- |",
  ...GROUPS.map((g) => `| ${g} | ${pct(unsure[g])} | ${fmt(kappa(out[g].role.model))} | ${fmt(kappa(out[g].role.expect))} | ${fmt(kappa(out[g].subtype.model))} | ${fmt(kappa(out[g].subtype.expect))} |`),
  "",
  `Target (top pick, sonar excluded — headerless): owner vs model ${pct(targets.model)} · owner vs expectations ${pct(targets.expect)}`,
  "",
  "## Disagreements",
  "",
  "| File | Column | Field | Against | Owner | Other |",
  "| --- | --- | --- | --- | --- | --- |",
  ...disagreements,
  "",
].join("\n");

mkdirSync("reports/blind", { recursive: true });
writeFileSync("reports/blind/agreement.md", md);
console.log(md);
