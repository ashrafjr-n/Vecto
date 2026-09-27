/* Report exports (lib/export/report.js): the content, the escaping, and — pinned
   hardest — that no format carries the rows or an unmasked personal value. */

import { reportModel, toMarkdown, toHtml, toJson, dataDictionaryCsv, exportStem } from "../src/lib/export/report.js";
import { analyzeWithDiagnostic } from "../src/lib/prep/diagnostic.js";
import { generateSampleData } from "../src/components/utils/core/index.js";

let failed = 0;
const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failed++;
};

const { data, columns } = generateSampleData();
const result = analyzeWithDiagnostic(data, columns, "churn");
const at = { fileName: "sample.csv", generatedAt: new Date("2026-09-27T12:00:00Z") };
const md = toMarkdown(reportModel(result, at));
const html = toHtml(reportModel(result, at));
const json = JSON.parse(toJson(result, at));

check("Markdown opens with the file, the verdict and the leak",
  md.startsWith("# Vecto report — sample.csv") && md.includes("Ready to train? — Not ready to train")
  && md.includes('Blocker: Possible target leakage in "exit_interview_score"'));
check("Markdown carries the score, the target signal, the plan and the recommendations",
  ["## Health score — 62/100", "## Target signal", "## Preparation plan", "## Recommendations"].every(h => md.includes(h)));
check("no report format carries the row preview",
  !md.includes("2017-07-08") && !html.includes("2017-07-08") && !("snapshot" in json));
check("JSON has the export header, the readiness verdict and the report",
  json.vecto.exportVersion === 1 && json.vecto.fileName === "sample.csv" && json.readiness.verdict === "blocked" && json.meta.rows === 503);
check("HTML is one file with no script and no external request",
  html.startsWith("<!doctype html>") && !/<script/i.test(html) && !/(src|href)=/i.test(html));

/* A hostile column name is text, not markup. */
const rows = Array.from({ length: 80 }, (_, i) => ({
  "<img src=x onerror=alert(1)>": String(i % 7), "a|b": String(i % 3), email: `u${i % 5}@example.com`, "note, with comma": "x",
  y: i % 2 ? "yes" : "no",
}));
const r2 = analyzeWithDiagnostic(rows, Object.keys(rows[0]), "y");
const html2 = toHtml(reportModel(r2));
check("column names are escaped in HTML", !html2.includes("<img") && html2.includes("&lt;img src=x onerror=alert(1)&gt;"));
check("a pipe in a column name does not break a Markdown table", toMarkdown(reportModel(r2)).includes("a\\|b"));

const csv = dataDictionaryCsv(r2, rows).trim().split("\n");
check("the dictionary has a header and one line per column", csv.length === 1 + Object.keys(rows[0]).length && csv[0].startsWith("column,role,"));
check("a comma in a column name is quoted", csv.some(l => l.startsWith('"note, with comma",')));
check("personal values in the dictionary are masked", !csv.join("\n").includes("@example.com") && csv.join("\n").includes("[email] ("));
const dict = dataDictionaryCsv(result, data).split("\n").find(l => l.startsWith("salary,"));
check("numeric columns carry min, median, max and mean", dict.startsWith("salary,numeric,no,498,5,1%,") && dict.includes(",30000,"));
check("a near-unique column lists no top values", dataDictionaryCsv(result, data).split("\n").find(l => l.startsWith("employee_id,")).endsWith(",,"));

check("export names are safe stems", exportStem("My data (v2).csv") === "vecto-my-data-v2" && exportStem(null) === "vecto-report");

if (failed) { console.error(`${failed} export check(s) failed`); process.exit(1); }
console.log("all export checks passed");
