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
