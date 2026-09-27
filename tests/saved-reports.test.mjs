/* Saved reports (lib/savedReports.js): what is kept, how many, and that a browser
   with no storage (Node has no IndexedDB, like a locked-down private window) loses
   nothing but the saving. */

import { toSavedRecord, idsBeyond, MAX_SAVED, listSavedReports, getSavedReport, saveReport } from "../src/lib/savedReports.js";
import { analyzeWithDiagnostic } from "../src/lib/prep/diagnostic.js";
import { generateSampleData } from "../src/components/utils/core/index.js";

let failed = 0;
const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failed++;
};

const { data, columns } = generateSampleData();
const result = analyzeWithDiagnostic(data, columns, "churn");
const record = toSavedRecord(result, { id: "abc12345", fileName: "people.csv", savedAt: 1, verdict: "blocked" });

check("the record keeps the summary the home list shows",
  record.id === "abc12345" && record.fileName === "people.csv" && record.target === "churn"
  && record.rows === 503 && record.columns === 13 && record.verdict === "blocked");
check("the record keeps the whole report", record.result.meta.rows === 503 && record.result.diagnostic.status === "ok");
check("the record never keeps rows: the preview is emptied, its column list kept",
  record.result.snapshot.rows.length === 0 && record.result.snapshot.columns.length === 13
  && !JSON.stringify(record).includes("2017-07-08"));
check("the report object the page holds is not changed", result.snapshot.rows.length === 10);

const many = Array.from({ length: MAX_SAVED + 3 }, (_, i) => ({ id: `r${i}`, savedAt: i }));
const stale = idsBeyond(many);
check("only the newest ten are kept; the three oldest go", stale.length === 3 && stale.sort().join() === "r0,r1,r2");
check("ten or fewer: nothing goes", idsBeyond(many.slice(0, MAX_SAVED)).length === 0);

check("with no storage, the list is empty rather than an error", (await listSavedReports()).length === 0);
check("with no storage, opening a saved report finds nothing", (await getSavedReport("abc12345")) === null);
check("with no storage, saving reports failure instead of throwing", (await saveReport(record)) === false);

if (failed) { console.error(`${failed} saved-report check(s) failed`); process.exit(1); }
console.log("all saved-report checks passed");
