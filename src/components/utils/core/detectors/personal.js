/* Personal data in cell values — email addresses, phone numbers, URLs, IP addresses,
   payment card numbers and IBANs. Pure, deterministic, no network.

   Two readers, one rule, so they cannot disagree:
     - the Quality section flags a column whose values ARE personal data
       (personalDataKind, via analyzers/quality.js);
     - the AI review masks every such value before anything leaves the browser
       (maskPersonalData, via lib/ai/dossier.js and lib/ai/review.js).

   Precision over recall. A column of timestamps, years or decimals flagged as phone
   numbers would teach a reader to ignore the flag, so every pattern below has a
   guard for the look-alike it was measured against. Names and addresses cannot be
   told from other text by a pattern and are not attempted. */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const URL   = /\bhttps?:\/\/[^\s"'<>]+|\bwww\.[^\s"'<>]+/gi;
const IPV4  = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
// Country code, check digits, then 11-30 letters or digits, optionally in groups of four.
const IBAN  = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b/g;
// Candidate digit runs with optional separators; card and phone rules decide below.
const DIGITS = /\+?\(?\d[\d\s().-]{5,}\d/g;

const DATE_LIKE  = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/;
const YEAR_RANGE = /^\d{4}\s?[-–]\s?\d{4}$/;
const PLAIN_NUMBER = /^[-+]?\d+(?:\.\d+)?$/;
const GROUPED_NUMBER = /^\d{1,3}(?:[,.]\d{3})+(?:[.,]\d+)?$/;

/* Luhn checksum — every payment card number passes it; a random digit run passes one
   time in ten, which the leading-digit rule narrows further. */
function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

/* A digit run → "card" | "phone" | null. */
function digitKind(match) {
  const text = match.trim();
  const digits = text.replace(/\D/g, "");
  if (DATE_LIKE.test(text) || YEAR_RANGE.test(text)) return null;
  // 13-19 digits from the card networks' ranges (3-6), Luhn-valid, written with or
  // without spaces. A millisecond timestamp is 13 digits too, but starts with 1.
  if (digits.length >= 13 && digits.length <= 19 && /^[3-6]/.test(digits) && luhn(digits)
      && /^[\d -]+$/.test(text)) return "card";
  if (PLAIN_NUMBER.test(text) || GROUPED_NUMBER.test(text)) return null;
  // A phone number starts with + or is written in three or more groups
  // ("415-555-2671", "(415) 555 2671"). One separator is a range, a code or a SKU
  // ("12345-678"), and a bare run of digits an id, a count or a timestamp.
  if (digits.length < 7 || digits.length > 15) return null;
  if (text.startsWith("+")) return "phone";
  const groups = text.split(/[\s().-]+/).filter(Boolean);
  return digits.length >= 9 && groups.length >= 3 ? "phone" : null;
}

export const PERSONAL_LABEL = {
  email: "email addresses",
  phone: "phone numbers",
  url:   "web addresses",
  ip:    "IP addresses",
  card:  "payment card numbers",
  iban:  "bank account numbers (IBAN)",
};

/* Every personal value inside a string replaced by a placeholder naming its kind:
   "call +44 20 7946 0958 or mail a@b.co" → "call [phone] or mail [email]". A value
   with nothing personal in it comes back unchanged. Order matters: an email or a URL
   holds digits the phone rule would otherwise take. */
export function maskPersonalData(value) {
  if (value == null) return value;
  let text = String(value);
  if (!/[@\d]|www\.|https?:/i.test(text)) return value;   // fast path: nothing to find
  text = text.replace(EMAIL, "[email]").replace(URL, "[url]").replace(IPV4, "[ip]").replace(IBAN, "[iban]");
  text = text.replace(DIGITS, (m, offset, whole) => {
    // Digits glued to a word are part of a code ("ORD-2023-000145"), not a number.
    if (/[A-Za-z_-]$/.test(whole.slice(0, offset))) return m;
    const kind = digitKind(m);
    if (!kind) return m;
    // Keep the characters around the number that the digit pattern swallowed.
    const lead = m.match(/^\s*/)[0], trail = m.match(/\s*$/)[0];
    return `${lead}[${kind}]${trail}`;
  });
  return text === String(value) ? value : text;
}

/* The kind of personal data a whole VALUE is, or null. A value that merely contains
   an email inside a sentence is text, not an email column. */
export function personalValueKind(value) {
  if (value == null) return null;
  const masked = maskPersonalData(String(value).trim());
  const hit = /^\[(email|url|ip|iban|card|phone)\]$/.exec(masked);
  return hit ? hit[1] : null;
}

/* The share of a column's present values that must be one kind of personal data
   before the column is flagged, and how many values are sampled to decide. */
export const PERSONAL_MIN_SHARE = 0.5;
const SAMPLE = 200;

/* → { kind, share } when at least half of an evenly spaced sample of the column's
   present values are one kind of personal data, else null. */
export function personalDataKind(values) {
  const present = values.filter(v => v != null && String(v).trim() !== "");
  if (present.length === 0) return null;
  const step = Math.max(1, Math.floor(present.length / SAMPLE));
  const counts = new Map();
  let sampled = 0;
  for (let i = 0; i < present.length && sampled < SAMPLE; i += step) {
    sampled++;
    const kind = personalValueKind(present[i]);
    if (kind) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  let best = null;
  for (const [kind, count] of counts) if (!best || count > best.count) best = { kind, count };
  if (!best || best.count / sampled < PERSONAL_MIN_SHARE) return null;
  return { kind: best.kind, share: Math.round((best.count / sampled) * 100) };
}
