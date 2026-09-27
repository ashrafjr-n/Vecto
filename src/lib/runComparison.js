/* The comparison off the main thread when a Worker is available, on it when not —
   the same contract as runAnalysis.js: always a Promise, never a throw. */

import { compareDatasets } from "./compare.js";

const direct = (train, test, result) => {
  try {
    return { comparison: compareDatasets(train, test, result), error: null };
  } catch (err) {
    return { comparison: null, error: err?.message ?? "Unknown error" };
  }
};

export function runComparison(train, test, result) {
  return new Promise((resolve) => {
    let worker;
    try {
      worker = new Worker(new URL("./compareWorker.js", import.meta.url), { type: "module" });
    } catch {
      resolve(direct(train, test, result));
      return;
    }
    const finish = (payload) => { worker.terminate(); resolve(payload); };
    worker.onmessage = (event) => finish(event.data);
    worker.onerror = () => finish(direct(train, test, result));
    try {
      worker.postMessage({ train, test, result });
    } catch {
      finish(direct(train, test, result));
    }
  });
}
