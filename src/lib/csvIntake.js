/* CSV intake decisions — pure, no React, no DOM.

   Home.jsx owns how an upload LOOKS; this module owns whether it is usable.
   Split out so the rules are testable in plain Node (tests/hardening.test.mjs):
   they used to live inside a Papa.parse() callback, where nothing could reach
   them and where results.errors was ignored outright. */

export const MAX_SIZE_MB = 40;
export const MAX_SIZE_B  = MAX_SIZE_MB * 1024 * 1024;

/* How many offending line numbers to name in the UI. The count is always exact;
   only the listed examples are capped. */
const ROW_SAMPLE = 3;

/* A header cell can be empty — an index column written by pandas or R is the
   common case, and smoking.csv has one. PapaParse then keys every row on the
   empty string, and every message the engine writes about that column reads
   `Drop "" before training`.

   Renaming it here, as a PapaParse `transformHeader`, is the only place the fix
   costs nothing: the header is rewritten before a single row object is built, so
   the rows are keyed correctly from the start instead of being rebuilt afterwards
   (941,009 rows × 22 columns of rebuilding, to fix a label).

   Pass it to every Papa.parse() call that reads a user's file, so the CLI report
   and the app describe the same columns. */
export function transformHeader(header, index) {
  return String(header ?? "").trim() === "" ? `column_${index + 1}` : header;
}

/* Bytes → text. UTF-8 first, strictly: a fatal decoder throws exactly when the bytes
   are not UTF-8, so a real UTF-8 file is never re-read. Only then windows-1252, the
   web's fallback for legacy files. UCI's Seoul Bike file is Latin-1: read as UTF-8,
   "Temperature(°C)" became "Temperature(�C)" in every card of the report, and the
   AI review could not name the column back. A leading BOM is dropped either way. */
export function decodeCsv(bytes) {
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252" };
  }
}

/* → "format" | "size" | null  (null = accepted) */
export function validateFile(file) {
  if (!file) return "format";
  if (!file.name?.toLowerCase().endsWith(".csv") && file.type !== "text/csv") return "format";
  if (file.size > MAX_SIZE_B) return "size";
  return null;
}

/* Verdict for a completed Papa.parse() result.
     { error: "parse", malformed: null }  — nothing usable, stop
     { error: null, malformed: null }     — clean
     { error: null, malformed: {...} }    — usable, but some rows were ragged

   PapaParse reports per-row problems (TooFewFields / TooManyFields / quoting)
   in results.errors while still returning the rows it could read. Previously
   only `fields` and `data.length` were checked, so a file with hundreds of
   broken rows went straight into the analyzer with no warning — every statistic
   downstream computed over partly-garbage rows that the user never saw. */
export function inspectParseResult(results) {
  const data = results?.data ?? [];
  const cols = results?.meta?.fields ?? null;

  if (!cols || cols.length === 0 || data.length === 0) {
    return { error: "parse", malformed: null };
  }

  // Only row-scoped errors point at real data damage. File-scoped ones
  // (e.g. UndetectableDelimiter) carry no row and must not fabricate a count.
  const badRows = [...new Set(
    (results.errors ?? [])
      .filter(e => Number.isInteger(e?.row))
      .map(e => e.row + 2),        // +2: data is 0-indexed and the header is line 1
  )].sort((a, b) => a - b);

  if (badRows.length === 0) return { error: null, malformed: null };

  return {
    error:     null,
    malformed: {
      count:      badRows.length,
      sampleRows: badRows.slice(0, ROW_SAMPLE),
      totalRows:  data.length,
    },
  };
}

/* A headerless CSV used to lose its first row silently: PapaParse turned it into
   the column names, so sonar's 60 readings became columns called "0.0200",
   "0.0371", … and one real row vanished from every statistic.

   A header cell written as a FRACTIONAL or NEGATIVE number is data, not a name —
   nobody titles a column "0.0371" or "-3". Whole numbers stay names on purpose:
   "2019", "2020" (a wide table of years) and "0", "1", "2" (pandas' default
   column labels) are real headers, and the values alone cannot tell them apart
   from an integer data row.
   ponytail: an all-integer headerless file is not caught — only a person can
   tell that row apart from a header of years or indices. */
const DATA_LIKE_HEADER = /^\s*(-\d+(\.\d+)?|[-+]?\d*\.\d+)([eE][-+]?\d+)?\s*$/;
export const HEADERLESS_MIN_SHARE = 0.5;

/* → { dataLike, total } when at least half the header cells look like data,
   else null. Reads PapaParse's renamedHeaders so a duplicated number
   ("0.0200" → "0.0200_1") is judged by what the file actually says. */
export function headerlessVerdict(results) {
  const fields  = results?.meta?.fields ?? [];
  const renamed = results?.meta?.renamedHeaders ?? {};
  const dataLike = fields.filter(f => DATA_LIKE_HEADER.test(renamed[f] ?? f)).length;
  return fields.length > 0 && dataLike / fields.length >= HEADERLESS_MIN_SHARE
    ? { dataLike, total: fields.length }
    : null;
}

/* Rows from a `header: false` parse → the same { data, fields } shape a header
   parse gives, keyed column_1 … column_N like a blank header (transformHeader).
   Width is the first row's, as a header row would have set it; a row of any
   other length is counted exactly as inspectParseResult counts one. */
export function headerlessRows(rows) {
  const width  = rows[0]?.length ?? 0;
  const fields = Array.from({ length: width }, (_, i) => `column_${i + 1}`);
  const badRows = [];
  const data = rows.map((cells, r) => {
    if (cells.length !== width) badRows.push(r + 1);   // +1: no header line
    const row = {};
    for (let i = 0; i < width && i < cells.length; i++) row[fields[i]] = cells[i];
    return row;
  });
  const malformed = badRows.length === 0 ? null : {
    count: badRows.length, sampleRows: badRows.slice(0, ROW_SAMPLE), totalRows: data.length,
  };
  return { data, fields, malformed };
}
