import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, Navigate } from "react-router-dom";
import { getPendingDataset } from "../lib/datasetHandoff.js";
import { AnimatePresence, motion } from "framer-motion";
import { LoaderCircle, TriangleAlert, X } from "lucide-react";

import Header         from "../components/layout/Header.jsx";
import TargetStep     from "../components/analyze/TargetStep/TargetStep.jsx";
/* Only reached at the results step — kept out of the target/processing path's chunk. */
const ResultsDashboard = lazy(() =>
  import("../components/analyze/ResultsDashboard/ResultsDashboard.jsx"));

import { detectTarget, generateSampleData } from "../components/utils/core/index.js";
import { runAnalysis, runAnalysisSync } from "../lib/runAnalysis.js";
import { applyCleaningRules } from "../lib/ai/cleaning.js";

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

/* The spinner now says what it is waiting for. frontend.md rules out a fake
   percentage and fake-progress theatre; this is neither — the label is the phase
   the engine is executing, posted from the worker as it enters it. The premise
   the spec was written on ("near-instant on realistic datasets") did not survive
   measurement: 386,414 rows x 17 columns is ~18 seconds of real work, and a bare
   spinner for that long tells the user nothing about whether anything is wrong.

   No phase yet means the worker has not started; the label is held back rather
   than guessed. */
function ProcessingStep({ phase, onCancel }) {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-6">
      <LoaderCircle size={26} className="animate-spin text-accent-ink" />
      {phase && (
        <div className="mt-10 text-center">
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink-faint">
            step {phase.index + 1} of {phase.total}
          </div>
          <div className="mt-5 text-[1.75rem] font-semibold leading-tight tracking-[-0.03em] text-ink sm:text-4xl">
            {phase.label}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={onCancel}
        className="mt-12 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-soft transition-colors hover:text-ink"
      >
        <X size={14} />
        Cancel
      </button>
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
  // Which phase the engine is in, pushed by runAnalysis while the worker runs.
  const [phase,          setPhase]          = useState(null);
  const [analysisResult, setAnalysisResult] = useState(entry?.result ?? null);
  const [failure,        setFailure]        = useState(entry?.error  ?? null);
  /* The AI dossier (verified) and the roles the user accepted from it. Held here,
     not in TargetStep, because Cancel on the processing step unmounts the picker
     and a finished answer costs a request from a small daily quota. */
  const [dossier,        setDossier]        = useState(null);
  const [roleOverrides,  setRoleOverrides]  = useState({});
  // The AI leakage review of the CURRENT report — cleared whenever a new analysis starts.
  const [leakageReview,  setLeakageReview]  = useState(null);
  /* Cleaning (AI phase D). `cleaningRules` are the rules the CURRENT report was built
     with, and `analysisData` the rows it was built from — both set only when an
     analysis completes, so a cancelled re-run leaves the report and its provenance
     consistent. `cleaning` holds the engine's candidates and the verified proposal;
     it describes the ORIGINAL file and survives re-runs. */
  const [analysisData,   setAnalysisData]   = useState(entry?.data   ?? null);
  const [cleaningRules,  setCleaningRules]  = useState([]);
  const [cleaning,       setCleaning]       = useState(null);
  // The running analysis's AbortController, so Cancel and unmount can stop it.
  const runRef = useRef(null);

  /* Leaving the page mid-analysis (back button, header link) would otherwise
     leave the worker computing a report nobody will see. This is a cleanup on
     unmount — synchronising with the worker outside React — not an effect
     watching `step`, which stays forbidden (see CLAUDE.md). */
  useEffect(() => () => runRef.current?.abort(), []);

  if (!entry) return <Navigate to="/" replace />;

  /* The analysis starts here, in the handler for the click that asked for it,
     rather than in an effect watching the step change (reactjs-principles.md §6).
     The minimum-visible delay is applied to the RESULT, not to the start: the
     work and the spinner's floor run concurrently, so a slow analysis costs its
     own time and a fast one still shows a spinner rather than a single flashed
     frame. */
  const startAnalysis = (selectedTarget, rules) => {
    setTarget(selectedTarget);
    setLeakageReview(null);
    setStep("processing");

    // Rules always apply to the file as uploaded, never to an already-cleaned copy.
    const rows = applyCleaningRules(csvData, rules).data;
    const startedAt = Date.now();
    const run = new AbortController();
    runRef.current = run;
    setPhase(null);
    runAnalysis(rows, columns, selectedTarget, setPhase, run.signal, roleOverrides).then(({ result, error }) => {
      const remaining = Math.max(0, MIN_VISIBLE_MS - (Date.now() - startedAt));
      setTimeout(() => {
        // Cancelled — including during the minimum-visible delay after the
        // worker had already answered. handleCancel has already moved the step.
        if (run.signal.aborted) return;
        if (error) {
          setFailure(error);
          setStep("failed");
          return;
        }
        setAnalysisResult(result);
        setAnalysisData(rows);
        setCleaningRules(rules);
        setStep("results");
      }, remaining);
    });
  };

  const handleTargetConfirmed = (selectedTarget) => startAnalysis(selectedTarget, cleaningRules);
  const handleApplyCleaning   = (rules) => startAnalysis(target, rules);

  /* Cancelled is not failed: back to the target picker with the chosen target
     kept, so the user can start again or pick a different one. */
  const handleCancel = () => {
    runRef.current?.abort();
    setStep("target");
  };

  const handleReset = () => navigate("/");

  return (
    /* Same `.night` scope as Home — see the gotcha in CLAUDE.md. The dotted
       canvas is the page itself here: every panel below is opaque, so the
       texture only shows in the gaps between them, which is exactly where Home
       puts it. */
    <div className="night dot-grid min-h-screen bg-paper text-ink">
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
                dossier={dossier}
                onDossier={setDossier}
                roleOverrides={roleOverrides}
                onRoleOverridesChange={setRoleOverrides}
              />
            </motion.div>
          )}

          {step === "processing" && (
            <motion.div key="processing" {...stepVariants}>
              <ProcessingStep phase={phase} onCancel={handleCancel} />
            </motion.div>
          )}

          {step === "failed" && (
            <motion.div key="failed" {...stepVariants}>
              <div className="mx-auto max-w-2xl px-6 py-24 sm:py-32">
                <div className="rounded-[2rem] border border-line bg-paper-sunken p-8 sm:p-10">
                  <div className="flex items-baseline gap-4 font-mono text-[11px] uppercase tracking-[0.22em] text-critical">
                    <TriangleAlert size={14} className="shrink-0" />
                    <span>Failed</span>
                    <span className="h-px flex-1 bg-line" />
                  </div>
                  <h1 className="mt-8 text-[1.75rem] font-semibold leading-[1.1] tracking-[-0.03em] text-ink sm:text-4xl">
                    Analysis could not be completed.
                  </h1>
                  <p className="mt-6 text-[15px] leading-[1.7] text-ink-soft">
                    The file was read, but the report failed to build. This usually means the
                    dataset is larger or more irregular than the analyzer can handle in the browser.
                  </p>
                  <p className="mt-6 border-t border-line pt-6 font-mono text-[12px] leading-relaxed text-ink-faint">
                    {failure}
                  </p>
                  <button
                    type="button"
                    onClick={handleReset}
                    className="mt-8 rounded-xl bg-ink px-6 py-3 text-[13px] font-semibold text-paper transition-opacity hover:opacity-90"
                  >
                    Start over
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {step === "results" && (
            <motion.div key="results" {...stepVariants}>
              <Suspense fallback={<div className="min-h-[60vh]" />}>
                <ResultsDashboard
                  result={analysisResult}
                  onReset={handleReset}
                  ai={{
                    data: analysisData, originalData: csvData, dossier,
                    leakageReview, onLeakageReview: setLeakageReview,
                    cleaning, onCleaning: setCleaning, cleaningRules, onApplyCleaning: handleApplyCleaning,
                  }}
                />
              </Suspense>
            </motion.div>
          )}

        </AnimatePresence>
      </main>
    </div>
  );
}

export default Analyze;
