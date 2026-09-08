/* ─────────────────────────────────────────────
   Datassert TEMPORAL detection — pure validator
   Precision over recall. Custom regex + explicit range
   validation. NEVER uses Date.parse / new Date (those are
   permissive & browser-inconsistent). Bare integers, years,
   and epoch timestamps have NO date structure → rejected.

   Supported (locked design):
     Tier 1 — ISO date + ISO datetime
     Tier 2 — slash/dot/dash numeric, with column-level day>12 disambiguation
     Tier 3 — month-name
   Deferred: epoch, compact YYYYMMDD, week/quarter/time-only, Excel serial.
───────────────────────────────────────────── */

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

// Tier 1 — ISO 8601 date: 2024-01-15
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
// Tier 1 — ISO 8601 datetime: 2024-01-15T10:30[:00][.123][Z|+05:00], space allowed for the T
const ISO_DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;
// Tier 2 — year-first numeric: 2024/01/15 or 2024.01.15 (dash reserved for ISO → unambiguous)
const SLASH_YMD = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/;
// Tier 2 — day/month-first numeric: 01/15/2024, 15-01-2024, 15.01.2024 (AMBIGUOUS mdy vs dmy)
const SLASH_DM = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/;
// Tier 3 — month-name token (alpha → cannot collide with numbers/IDs)
const MONTH_ALT =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?" +
  "|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const MONTH_DAY_FIRST = new RegExp(`^(${MONTH_ALT})\\s+(\\d{1,2}),?\\s+(\\d{2,4})$`, "i"); // Jan 15, 2024
const DAY_MONTH_FIRST = new RegExp(`^(\\d{1,2})[\\s\\-]+(${MONTH_ALT})[\\s\\-]+(\\d{2,4})$`, "i"); // 15-Jan-2024

const inMonth = m => m >= 1 && m <= 12;
const inDay   = d => d >= 1 && d <= 31;   // 31 cap is enough for typing (not calendar-exact)
const inTime  = (h, mi, s) => h >= 0 && h <= 23 && mi >= 0 && mi <= 59 && (s === undefined || (s >= 0 && s <= 59));

/* dateFamily — returns { family, p1, p2 } if the string is a valid date, else null.
   p1/p2 are the raw leading two components; only meaningful for the ambiguous
   "slash_dm" family (used by the column-level day>12 disambiguation). */
function dateFamily(str) {
  if (typeof str !== "string") return null;
  const s = str.trim();
  if (s === "") return null;

  let m;

  // Tier 1 — ISO date
  if ((m = ISO_DATE.exec(s))) {
    const mo = +m[2], d = +m[3];
    return inMonth(mo) && inDay(d) ? { family: "iso" } : null;
  }
  // Tier 1 — ISO datetime
  if ((m = ISO_DATETIME.exec(s))) {
    const mo = +m[2], d = +m[3], h = +m[4], mi = +m[5], sec = m[6] === undefined ? undefined : +m[6];
    return inMonth(mo) && inDay(d) && inTime(h, mi, sec) ? { family: "iso" } : null;
  }
  // Tier 2 — year-first numeric (unambiguous)
  if ((m = SLASH_YMD.exec(s))) {
    const mo = +m[2], d = +m[3];
    return inMonth(mo) && inDay(d) ? { family: "slash_ymd" } : null;
  }
  // Tier 3 — month-name (checked before slash_dm; contains alpha so no numeric overlap)
  if ((m = MONTH_DAY_FIRST.exec(s))) {
    const mo = MONTHS[m[1].toLowerCase()], d = +m[2];
    return mo && inDay(d) ? { family: "month" } : null;
  }
  if ((m = DAY_MONTH_FIRST.exec(s))) {
    const d = +m[1], mo = MONTHS[m[2].toLowerCase()];
    return mo && inDay(d) ? { family: "month" } : null;
  }
  // Tier 2 — day/month-first numeric (ambiguous): accept if EITHER orientation is a valid date
  if ((m = SLASH_DM.exec(s))) {
    const p1 = +m[1], p2 = +m[2];
    const mdy = inMonth(p1) && inDay(p2);   // p1=month, p2=day (US)
    const dmy = inMonth(p2) && inDay(p1);   // p1=day, p2=month (EU)
    return (mdy || dmy) ? { family: "slash_dm", p1, p2 } : null;
  }

  return null;
}

/* isTemporalColumn — a column is TEMPORAL iff ≥90% of the non-missing sample are valid
   dates of ONE consistent family. Guards: the 90% rule rejects a categorical column with
   a stray date value; the single-family rule rejects mixed formats; the day>12 rule
   rejects an ambiguous slash column whose mdy/dmy orientation conflicts. */
export function isTemporalColumn(sample) {
  if (!Array.isArray(sample) || sample.length === 0) return false;

  const fams = sample.map(v => dateFamily(String(v).trim()));
  const validCount = fams.filter(f => f !== null).length;
  if (validCount / sample.length < 0.9) return false;          // 90% rule

  // one dominant family must cover ≥90% (mixed formats → not a clean temporal column)
  const famCount = {};
  for (const f of fams) if (f) famCount[f.family] = (famCount[f.family] || 0) + 1;
  const [domFam, domCount] = Object.entries(famCount).sort((a, b) => b[1] - a[1])[0];
  if (domCount / sample.length < 0.9) return false;

  // column-level day>12 disambiguation for the ambiguous slash family
  if (domFam === "slash_dm") {
    const dm = fams.filter(f => f && f.family === "slash_dm");
    const anyP1over12 = dm.some(f => f.p1 > 12);   // → dmy (EU)
    const anyP2over12 = dm.some(f => f.p2 > 12);   // → mdy (US)
    if (anyP1over12 && anyP2over12) return false;  // conflicting orientations → reject
  }

  return true;
}
