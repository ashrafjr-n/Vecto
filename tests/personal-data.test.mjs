/* Personal data: the Quality flag and the masking of every value the AI review sends.
   Precision is pinned as hard as recall — a flag that fires on timestamps, dates or
   order codes teaches the reader to ignore it. */

import { maskPersonalData, personalValueKind, personalDataKind } from "../src/components/utils/core/detectors/personal.js";
import { analyzeDataset, detectColumnRoles } from "../src/components/utils/core/index.js";
import { buildReviewPayload } from "../src/lib/ai/review.js";
import { findCleaningCandidates } from "../src/lib/ai/cleaning.js";

let failed = 0;
const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failed++;
};

const found = {
  "ali@example.com": "email", "+972 59 123 4567": "phone", "(415) 555-2671": "phone", "415-555-2671": "phone",
  "4111 1111 1111 1111": "card", "4111111111111111": "card", "https://vecto.dev/x?y=1": "url", "www.google.com": "url",
  "192.168.0.1": "ip", "DE89370400440532013000": "iban", "GB29 NWBK 6016 1331 9268 19": "iban",
};
for (const [value, kind] of Object.entries(found)) {
  check(`${JSON.stringify(value)} is read as ${kind}`, personalValueKind(value) === kind && maskPersonalData(value) === `[${kind}]`);
}

const lookalikes = ["1695712345678", "2020-01-15", "15/01/2020", "2019-2020", "3.14159265", "1,234,567", "1.234.567",
  "123456789", "12:30:45", "Temperature(°C)", "125+", "v1.2.3", "Model X-200", "ORD-2023-000145", "$1,200.50",
  "-12.5", "1e-5", "05-12", "SKU 12345-678", "", "NA"];
check("look-alikes (timestamps, dates, decimals, codes, SKUs) are left untouched",
  lookalikes.every(v => maskPersonalData(v) === v && personalValueKind(v) === null));

check("personal data inside a sentence is masked in place",
  maskPersonalData("call +44 20 7946 0958 or mail a@b.co") === "call [phone] or mail [email]");
check("a sentence holding an email is text, not an email value", personalValueKind("mail me at a@b.co") === null);
check("null and numbers pass through", maskPersonalData(null) === null && maskPersonalData(42) === 42);

/* The column flag: half of a sample must be one kind. */
check("a column of emails is flagged, with its share",
  personalDataKind(["a@b.co", "c@d.org", "e@f.net", ""]).kind === "email" && personalDataKind(["a@b.co", "c@d.org"]).share === 100);
check("a column with the odd email is not flagged", personalDataKind(["x", "y", "z", "a@b.co"]) === null);

const rows = Array.from({ length: 120 }, (_, i) => ({
  id: String(i + 1),
  email: `user${i}@example.com`,
  phone: `+972 59 ${String(100 + i).padStart(3, "0")} ${String(1000 + i * 7).slice(0, 4)}`,
  city: ["Haifa", "Jaffa", "Akka"][i % 3],
  spend: String((i * 37) % 500),
  churn: i % 4 === 0 ? "yes" : "no",
}));
const columns = Object.keys(rows[0]);
const report = analyzeDataset(rows, columns, "churn");
const personal = report.quality.columnsWithIssues.filter(c => c.issue === "personal_data");
check("the report flags the email and phone columns, and nothing else",
  personal.map(c => `${c.col}:${c.kind}`).sort().join() === "email:email,phone:phone");
check("the flag says what to do and that AI reviews mask it", /stable hash/.test(personal[0].detail) && /masked/.test(personal[0].detail));
/* Same file, the addresses swapped for plain distinct codes: the score must not move. */
const coded = rows.map((r, i) => ({ ...r, email: `u${i}x`, phone: `p${i}y` }));
check("a personal-data flag does not move the quality score",
  report.quality.qualityScore === analyzeDataset(coded, columns, "churn").quality.qualityScore);

const roles = detectColumnRoles(rows, columns, null);
const payload = JSON.stringify(buildReviewPayload(rows, columns, roles, findCleaningCandidates(rows, columns, roles)));
check("no email address or phone number reaches the AI review payload",
  !/@example\.com/.test(payload) && !/\+972/.test(payload) && /\[email\]/.test(payload) && /\[phone\]/.test(payload));
check("ordinary values still reach it", /Haifa/.test(payload));

/* Cleaning candidates carry real values; they are masked on the way out only. */
const messy = Array.from({ length: 60 }, (_, i) => ({ contact: i % 2 ? `${i} kg` : String(i), note: "x" }));
const candidates = [{ name: "contact", role: "numeric", present: 60, candidates: [
  { kind: "numeric_affix", affixes: [{ affix: "kg", count: 3, examples: ["ali@example.com", "5 kg"] }] },
  { kind: "level_collision", groups: [[["a@b.co", 2], ["A@B.CO", 1]]] },
] }];
const reviewed = buildReviewPayload(messy, ["contact", "note"], { contact: "numeric", note: "categorical" }, candidates);
const sentCandidates = JSON.stringify(reviewed.columns[0].cleaning);
check("cleaning candidates are masked in the payload", !/@/.test(sentCandidates) && /5 kg/.test(sentCandidates));
check("the candidates the browser keeps are not masked", candidates[0].candidates[0].affixes[0].examples[0] === "ali@example.com");

if (failed) { console.error(`${failed} personal-data check(s) failed`); process.exit(1); }
console.log("all personal-data checks passed");
