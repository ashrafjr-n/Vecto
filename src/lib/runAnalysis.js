/* Running the analysis without freezing the page.

   Every caller gets a Promise, whether or not a Worker was actually used, so
   the calling code has one shape to handle.

   Cost of the move, measured on 400,000 rows: sending the parsed data to the
   worker is a structured clone costing ~637ms of main-thread time, against
   ~6,770ms of analysis. The page still blocks briefly, but for a tenth as long.
   (A columnar transfer would cut the clone to ~213ms, but that means reshaping
   what the engine accepts — not worth it for the difference.)

   The main thread keeps the parsed rows regardless: TargetStep runs
   detectColumnRoles on them to draw the target picker, so the clone is a copy,
   not a handover. */

import { analyzeWithDiagnostic } from "./prep/diagnostic.js";

/* Direct call, errors returned rather than thrown. The results-step call site is
   asynchronous and ErrorBoundary only catches errors thrown during render, so a
   throw escaping here leaves a spinner turning forever with no message. */
export function runAnalysisSync(data, columns, target, onPhase, roleOverrides) {
  try {
    return { result: analyzeWithDiagnostic(data, columns, target, onPhase, roleOverrides), error: null };
  } catch (err) {
    console.error("analyzeDataset() failed:", err);
    return { result: null, error: err?.message ?? "Unknown error" };
  }
}

/* Off the main thread when the environment allows it, on it when not.

   The fallback is not a nicety: `Worker` is absent in Node (so the engine stays
   testable without a DOM), module workers can be blocked by a Content Security
   Policy, and a bundling problem would surface as a load error rather than a
   thrown exception. In every one of those cases the analysis still runs and
   still returns the same shape — the page just blocks while it does, exactly as
   it did before this file existed. Degrading to the old behaviour is always
   better than showing nothing.

   `signal` (an AbortSignal) cancels a running analysis: the worker is
   terminated and the promise settles with `aborted: true` and no error. The
   synchronous fallback cannot be cancelled — it owns the main thread, so
   nothing could deliver the abort until it had already finished.

   `roleOverrides` ({ column: ROLE }) are the user's accepted role decisions,
   passed straight through to analyzeDataset(). */
export function runAnalysis(data, columns, target, onPhase, signal, roleOverrides) {
  return new Promise((resolve) => {
    let worker;
    try {
      worker = new Worker(new URL("./analysisWorker.js", import.meta.url), { type: "module" });
    } catch {
      resolve(runAnalysisSync(data, columns, target, onPhase, roleOverrides));
      return;
    }

    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      resolve(payload);
    };
    signal?.addEventListener("abort",
      () => finish({ result: null, error: null, aborted: true }), { once: true });

    /* A phase update is not the answer. Only the message carrying result/error
       settles the promise; everything tagged "phase" is forwarded and dropped. */
    worker.onmessage = (event) => {
      if (event.data?.type === "phase") { onPhase?.(event.data.phase); return; }
      finish(event.data);
    };
    // The fallback still reports its phases — on the main thread, so the screen
    // will not repaint between them, but the caller's contract does not change.
    worker.onerror   = () => finish(runAnalysisSync(data, columns, target, onPhase, roleOverrides));

    try {
      worker.postMessage({ data, columns, target, roleOverrides });
    } catch {
      // Structured clone can refuse a value the engine would have accepted.
      finish(runAnalysisSync(data, columns, target, onPhase, roleOverrides));
    }
  });
}
