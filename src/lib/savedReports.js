/* Saved reports — the last few reports, kept in this browser's IndexedDB so a refresh,
   a closed tab or tomorrow does not lose them.

   What is kept is the REPORT, never the file: every figure and finding, without the
   10-row preview (toSavedRecord). So a saved report can be read and exported, but its
   target cannot be changed and it cannot be reviewed by AI — both need the rows,
   and the rows were never stored. Nothing here leaves the browser.

   Storage can be missing or refuse (a private window, blocked site data): every call
   below catches, and the app works exactly as before without it. */

export const MAX_SAVED = 10;
const DB_NAME = "vecto";
const STORE = "reports";

/* The record kept for a report. Pure, so the "no rows" rule is testable in Node. */
export function toSavedRecord(result, { id, fileName = null, savedAt = Date.now(), cleaningRules = [], verdict = null }) {
  const { snapshot, ...report } = result;
  return {
    id,
    savedAt,
    fileName,
    target: result.meta.target ?? null,
    rows: result.meta.rows,
    columns: result.meta.columns,
    verdict,
    cleaningRules,
    result: { ...report, snapshot: { columns: snapshot?.columns ?? [], rows: [] } },
  };
}

/* The ids to delete so that at most `max` remain, oldest first out. */
export function idsBeyond(records, max = MAX_SAVED) {
  return [...records].sort((a, b) => b.savedAt - a.savedAt).slice(max).map((r) => r.id);
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("no IndexedDB")); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const out = fn(tx.objectStore(STORE));
      /* A request's answer is its `result` — which is undefined for a key that is not
         there. Reading `out?.result ?? out` returned the request object itself in that
         case, and a missing report opened as a blank one. */
      const isRequest = out && typeof out === "object" && "readyState" in out;
      tx.oncomplete = () => resolve(isRequest ? out.result : out);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/* The list for the home page: newest first, without the reports themselves. */
export async function listSavedReports() {
  try {
    const all = await withStore("readonly", (s) => s.getAll());
    return (all ?? [])
      .sort((a, b) => b.savedAt - a.savedAt)
      .map((record) => ({ ...record, result: undefined }));
  } catch {
    return [];
  }
}

export async function getSavedReport(id) {
  try {
    return (await withStore("readonly", (s) => s.get(id))) ?? null;
  } catch {
    return null;
  }
}

/* Save (or replace — a re-run on the same file keeps its id) and keep the newest MAX_SAVED. */
export async function saveReport(record) {
  try {
    await withStore("readwrite", (s) => { s.put(record); });
    const all = await withStore("readonly", (s) => s.getAll());
    const stale = idsBeyond(all ?? []);
    if (stale.length) await withStore("readwrite", (s) => { for (const id of stale) s.delete(id); });
    return true;
  } catch {
    return false;
  }
}

export async function deleteSavedReport(id) {
  try { await withStore("readwrite", (s) => { s.delete(id); }); return true; } catch { return false; }
}

export async function clearSavedReports() {
  try { await withStore("readwrite", (s) => { s.clear(); }); return true; } catch { return false; }
}
