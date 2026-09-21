/* Dataset report CLI — runs the real engine over real CSVs and writes the full
   analyzeDataset() output to JSON, so a finding survives the session that found it.

   Parsing matches Home.jsx exactly (header + skipEmptyLines, no dynamicTyping):
   a report built from differently-parsed input is a report about a different
   dataset. Intake verdicts come from csvIntake.js for the same reason — the file
   size cap and the ragged-row warning are part of what is being tested.

   Usage:  node tools/report.mjs <file.csv ...> [--target=Col] [--out=reports]
           node tools/report.mjs data/*.csv                  (target auto-detected)
*/

import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import Papa from "papaparse";

import { analyzeDataset, detectTarget } from "../src/components/utils/core/index.js";
import {
  inspectParseResult, transformHeader, headerlessVerdict, headerlessRows, MAX_SIZE_MB, MAX_SIZE_B,
} from "../src/lib/csvIntake.js";

const args    = process.argv.slice(2);
const files   = args.filter(a => !a.startsWith("--"));
const flag    = name => args.find(a => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const outDir  = flag("out") ?? "reports";
const target  = flag("target") ?? null;

if (files.length === 0) {
  console.error("usage: node tools/report.mjs <file.csv ...> [--target=Col] [--out=reports]");
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

for (const file of files) {
  const name   = basename(file, extname(file));
  const bytes  = statSync(file).size;
  const text   = readFileSync(file, "utf8");
  let parsed   = Papa.parse(text, { header: true, skipEmptyLines: true, transformHeader });
  let intake   = inspectParseResult(parsed);
  /* A first row of data is read as data — the answer the app pre-selects. The
     CLI has nobody to ask, so the choice is recorded instead of made silently. */
  const headerless = headerlessVerdict(parsed);
  if (headerless) {
    const rows = headerlessRows(Papa.parse(text, { skipEmptyLines: true }).data);
    parsed = { data: rows.data, meta: { fields: rows.fields } };
    intake = { error: null, malformed: rows.malformed };
  }

  const report = {
    file,
    bytes,
    /* The app refuses this file before it ever reaches the engine — reported,
       not enforced, so an oversized dataset can still be analyzed here. */
    overSizeCap: bytes > MAX_SIZE_B ? `${MAX_SIZE_MB}MB cap exceeded` : null,
    intake,
    headerless,
    rows: parsed.data.length,
    columns: parsed.meta.fields ?? [],
    target: null,
    ms: null,
    error: null,
    result: null,
  };

  if (intake.error) {
    console.log(`${name}: UNUSABLE (${intake.error})`);
  } else {
    const columns = parsed.meta.fields;
    report.target = target ?? detectTarget(columns, parsed.data);

    const t0 = performance.now();
    try {
      report.result = analyzeDataset(parsed.data, columns, report.target);
    } catch (err) {
      report.error = { message: err?.message ?? String(err), stack: err?.stack ?? null };
    }
    report.ms = Math.round(performance.now() - t0);

    const score = report.result?.healthScore;
    console.log(
      report.error
        ? `${name}: THREW — ${report.error.message}`
        : `${name}: ${report.rows} rows × ${columns.length} cols · target=${report.target ?? "none"}` +
          ` · health ${score?.score ?? "?"} ${score?.grade ?? ""}` +
          ` · ${report.ms}ms${intake.malformed ? ` · ${intake.malformed.count} ragged rows` : ""}`,
    );
  }

  const out = join(outDir, `${name}.json`);
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`  → ${out}`);
}
