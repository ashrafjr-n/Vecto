import { lazy, Suspense, useState } from "react";
import { useLocation, useNavigate, Navigate } from "react-router-dom";
import { getPendingDataset } from "../lib/datasetHandoff.js";
import { AnimatePresence, motion } from "framer-motion";
import { LoaderCircle, TriangleAlert } from "lucide-react";

import Header         from "../components/layout/Header.jsx";
import TargetStep     from "../components/analyze/TargetStep/TargetStep.jsx";
/* Only reached at the results step — kept out of the target/processing path's chunk. */
const ResultsDashboard = lazy(() =>
  import("../components/analyze/ResultsDashboard/ResultsDashboard.jsx"));

import { detectTarget, generateSampleData } from "../components/utils/core/index.js";
import { runAnalysis, runAnalysisSync } from "../lib/runAnalysis.js";

const stepVariants = {
  initial:  { opacity: 0, y: 16 },
  animate:  { opacity: 1, y: 0,  transition: { duration: 0.32, ease: "easeOut" } },
  exit:     { opacity: 0, y: -10, transition: { duration: 0.2,  ease: "easeIn"  } },
};

/* Minimal spinner-only loading step. No copy, no fake progress — see frontend.md
   "Processing step" spec. It is now a pure spinner: it no longer owns a timer or
   triggers the analysis. The work is started by the event handler that caused it
   (reactjs-principles.md §6 — don't use an effect to handle an event), and the
   minimum-visible delay lives there too, next to the thing it is pacing.

   The spinner also finally spins during the analysis. It could not before: the
   work ran on the main thread, so the animation was frozen for exactly as long
   as the user was waiting. */
const MIN_VISIBLE_MS = 550;
function ProcessingStep() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <LoaderCircle size={28} className="animate-spin text-gold-ink" />
    </div>
  );
}

function Analyze() {
  const location = useLocation();
  const navigate = useNavigate();

  /* Single entry point for how this page can be reached, computed once on first
     render (no effect, no flash): either `?sample=1` (generated demo data, skips
     straight to results) or a real upload handed off from Home via the
     datasetHandoff module singleton (NOT router state — see that file for why).
     Anything else — a direct visit or a hard refresh with nothing pending — has
     nothing to analyze and is redirected back to "/" below. */
  const [entry] = useState(() => {
    if (new URLSearchParams(location.search).get("sample")) {
      const { data, columns: cols } = generateSampleData();
      const detectedTarget          = detectTarget(cols, data);
      /* Synchronous on purpose: the sample is 500 generated rows, analysed in
         single-digit milliseconds, and going async here would mean rendering a
         spinner for a frame on a page that has nothing to wait for. */
      const { result, error }       = runAnalysisSync(data, cols, detectedTarget);
      return {
        step: error ? "failed" : "results",
        data, columns: cols, target: detectedTarget, result, error,
      };
    }
    const pending = getPendingDataset();
    if (pending) {
      const { data, columns: cols } = pending;
      return { step: "target", data, columns: cols, target: detectTarget(cols, data), result: null, error: null };
    }
    return null;
  });

  const [step,           setStep]           = useState(entry?.step   ?? "target");
  const [csvData]                           = useState(entry?.data    ?? null);
  const [columns]                           = useState(entry?.columns ?? []);
  const [target,         setTarget]         = useState(entry?.target ?? "");
  const [analysisResult, setAnalysisResult] = useState(entry?.result ?? null);
  const [failure,        setFailure]        = useState(entry?.error  ?? null);

  if (!entry) return <Navigate to="/" replace />;

  /* The analysis starts here, in the handler for the click that asked for it,
     rather than in an effect watching the step change (reactjs-principles.md §6).
     The minimum-visible delay is applied to the RESULT, not to the start: the
     work and the spinner's floor run concurrently, so a slow analysis costs its
     own time and a fast one still shows a spinner rather than a single flashed
     frame. */
  const handleTargetConfirmed = (selectedTarget) => {
    setTarget(selectedTarget);
    setStep("processing");

    const startedAt = Date.now();
    runAnalysis(csvData, columns, selectedTarget).then(({ result, error }) => {
      const remaining = Math.max(0, MIN_VISIBLE_MS - (Date.now() - startedAt));
      setTimeout(() => {
        if (error) {
          setFailure(error);
          setStep("failed");
          return;
        }
        setAnalysisResult(result);
        setStep("results");
      }, remaining);
    });
  };

  const handleReset = () => navigate("/");

  return (
    <div className="min-h-screen bg-paper text-ink">
      <Header />

      <main className="pt-16">
        <AnimatePresence mode="wait">

          {step === "target" && (
            <motion.div key="target" {...stepVariants}>
              <TargetStep
                columns={columns}
                csvData={csvData}
                initialTarget={target}
                onConfirm={handleTargetConfirmed}
                onBack={handleReset}
              />
            </motion.div>
          )}

          {step === "processing" && (
            <motion.div key="processing" {...stepVariants}>
              <ProcessingStep />
            </motion.div>
          )}

          {step === "failed" && (
            <motion.div key="failed" {...stepVariants}>
              <div className="mx-auto max-w-xl px-6 py-24 text-center">
                <TriangleAlert size={28} className="mx-auto text-critical" />
                <h1 className="mt-4 text-xl font-semibold text-ink">Analysis could not be completed.</h1>
                <p className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">
                  The file was read, but the report failed to build. This usually means the
                  dataset is larger or more irregular than the analyzer can handle in the browser.
                </p>
                <p className="mt-3 font-mono text-[12px] text-ink-faint">{failure}</p>
                <button
                  type="button"
                  onClick={handleReset}
                  className="mt-6 rounded-lg bg-ink px-5 py-2.5 text-[13px] font-semibold text-paper transition-opacity hover:opacity-90"
                >
                  Start over
                </button>
              </div>
            </motion.div>
          )}

          {step === "results" && (
            <motion.div key="results" {...stepVariants}>
              <Suspense fallback={<div className="min-h-[60vh]" />}>
                <ResultsDashboard result={analysisResult} onReset={handleReset} />
              </Suspense>
            </motion.div>
          )}

        </AnimatePresence>
      </main>
    </div>
  );
}

export default Analyze;
