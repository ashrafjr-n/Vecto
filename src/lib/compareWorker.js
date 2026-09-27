/* Web Worker entry for the train/test comparison (compare.js) — the same pattern as
   analysisWorker.js: pure work off the main thread, errors returned, not thrown. */

import { compareDatasets } from "./compare.js";

self.onmessage = (event) => {
  const { train, test, result } = event.data ?? {};
  try {
    self.postMessage({ comparison: compareDatasets(train, test, result), error: null });
  } catch (err) {
    self.postMessage({ comparison: null, error: err?.message ?? "Unknown error" });
  }
};
