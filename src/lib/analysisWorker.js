/* Web Worker entry point — runs the analysis engine off the main thread.

   analyzeDataset() is pure and synchronous and walks the entire parsed file.
   Measured on a 400,000-row / 11MB CSV: parsing 826ms, analysis 6,770ms. For
   those ~6.8 seconds the page was completely frozen — no spinner animation, no
   scroll, no way to cancel — because there is only one main thread and the
   analysis owned all of it. That is what this file exists to stop.

   The engine is imported here exactly as it is imported anywhere else: it stays
   pure, offline and deterministic, and knows nothing about where it runs. */

import { analyzeDataset } from "../components/utils/core/index.js";

self.onmessage = (event) => {
  const { data, columns, target } = event.data ?? {};
  try {
    /* Phase messages are tagged so runAnalysis() can tell an update from the
       answer. The final message carries `result`/`error` and nothing else does. */
    const onPhase = (phase) => self.postMessage({ type: "phase", phase });
    self.postMessage({ result: analyzeDataset(data, columns, target, onPhase), error: null });
  } catch (err) {
    // Errors are RETURNED, not thrown. A throw here would surface as a bare
    // worker error event with no message, which is how the old synchronous path
    // used to leave the spinner turning forever.
    self.postMessage({ result: null, error: err?.message ?? "Unknown error" });
  }
};
