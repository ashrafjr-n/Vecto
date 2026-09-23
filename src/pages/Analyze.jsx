import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, Navigate } from "react-router-dom";
import { getPendingDataset } from "../lib/datasetHandoff.js";
import { AnimatePresence, motion } from "framer-motion";
import { LoaderCircle, TriangleAlert, X } from "lucide-react";

import Header         from "../components/layout/Header.jsx";
import Footer         from "../components/layout/Footer.jsx";
import TargetStep     from "../components/analyze/TargetStep/TargetStep.jsx";
/* Only reached at the results step — kept out of the target/processing path's chunk. */
const ResultsDashboard = lazy(() =>
  import("../components/analyze/ResultsDashboard/ResultsDashboard.jsx"));

import { detectTarget, generateSampleData } from "../components/utils/core/index.js";
import { runAnalysis, runAnalysisSync } from "../lib/runAnalysis.js";
import { applyCleaningRules } from "../lib/ai/cleaning.js";
import { buildLeakagePayload, verifyLeakage } from "../lib/ai/leakage.js";
import { requestAi } from "../lib/ai/requestAi.js";
import { useSession, hasQuota } from "../components/auth/sessionContext.js";

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
        <div className="mt-8 text-center">
          <div className="text-[13px] text-ink-faint">
            Step {phase.index + 1} of {phase.total}
          </div>
          <div className="mt-3 text-[1.5rem] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-3xl">
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

/* One id per dataset, for the whole of its life on this page — the column review
   (which may be several parts) and the leakage review share it, so the server
   charges ONE of the user's free analyses for the file however many requests it
   takes. Re-running with cleaning rules keeps it: still the same dataset. */
function newAnalysisId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function Analyze() {
  const location = useLocation();
  const navigate = useNavigate();
  const session = useSession();
  const { applyUsage } = session;

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
      const { data, columns: cols, encoding } = pending;
      return { step: "target", data, columns: cols, encoding, target: detectTarget(cols, data), result: null, error: null };
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
  /* The AI leakage review of the CURRENT report — cleared whenever a new analysis
     starts. The REQUEST lives here rather than in the panel because the panel only
     mounts when the Target Signal tab is open, and C is meant to be already running
     by the time the user gets there. */
  const [leakageReview,  setLeakageReview]  = useState(null);
  const [leakageStatus,  setLeakageStatus]  = useState("idle");
  const [leakageFailure, setLeakageFailure] = useState(null);
  /* Whether the user has asked for anything AI in this session. C starts by itself
     only after that: an automatic first request would send a column profile to a
     third party for someone who never opted in. Cleared by nothing — leaving the
     page is what ends the session. */
  const [aiOptedIn,      setAiOptedIn]      = useState(false);
  const [analysisId] = useState(newAnalysisId);
  /* Cleaning (AI phase D). `cleaningRules` are the rules the CURRENT report was built
     with, and `analysisData` the rows it was built from — both set only when an
     analysis completes, so a cancelled re-run leaves the report and its provenance
     consistent. `cleaning` holds the engine's candidates and the verified proposal;
     it describes the ORIGINAL file and survives re-runs. */
  const [analysisData,   setAnalysisData]   = useState(entry?.data   ?? null);
  const [cleaningRules,  setCleaningRules]  = useState([]);
  const [cleaning,       setCleaning]       = useState(null);
  /* The rules the user has ticked — on the target step (column review) or on the
     Quality tab. The next analysis is built with exactly these. */
  const [acceptedRules,  setAcceptedRules]  = useState([]);
  // The running analysis's AbortController, so Cancel and unmount can stop it.
  const runRef = useRef(null);
  // The same, for the leakage request, which outlives the click that started it.
  const leakRunRef = useRef(null);

  /* STILL exactly one effect, and it still does not watch `step` — that pattern
     stays forbidden (see CLAUDE.md). It does two things, both of which are
     "synchronise with something outside React" (reactjs-principles.md §6):

     1. On mount, for a fresh upload, START the analysis. A dropped file goes
        straight to its report now; the target picker is no longer a gate in front
        of it, it is a thing you open when you want to change the target. The
        engine's own detectTarget guess is the starting target, exactly as it was
        the pre-selected default in the picker before — no AI is involved in
        getting a report, and none is needed.
     2. On unmount, abort whatever is running, so leaving mid-analysis does not
        leave the worker computing a report nobody will see.

     There is deliberately NO "have I started already" ref. React 19 StrictMode
     mounts, cleans up and mounts again in dev, so a guard like that leaves the
     run its own cleanup just aborted and nothing restarts it — the spinner then
     turns for ever, in dev only. Start-on-mount / abort-on-cleanup is the pair
     that survives both: the second mount starts a fresh run, and the aborted
     first one returns at its own `run.signal.aborted` check. */
  useEffect(() => {
    if (entry?.step === "target") startAnalysis(entry.target, []);
    return () => { runRef.current?.abort(); leakRunRef.current?.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!entry) return <Navigate to="/" replace />;

  /* The analysis starts here, in the handler for the click that asked for it,
     rather than in an effect watching the step change (reactjs-principles.md §6).
     The minimum-visible delay is applied to the RESULT, not to the start: the
     work and the spinner's floor run concurrently, so a slow analysis costs its
     own time and a fast one still shows a spinner rather than a single flashed
     frame. */
  /* Phase C. Called by the results handler below (automatically, once the user has
     opted into AI) and by the panel's own button. It takes `result` and `rows` as
     arguments rather than reading state: at the moment the analysis lands, the state
     holding them has not been set yet.

     A target that never varies or is unique per row has no timing to reason about,
     so C is not asked about it — the same rule that hides the panel in
     TargetSignalTab. Failures stay in `leakageFailure` and are shown only inside the
     panel; nothing else on the report depends on this. */
  const runLeakageReview = (result, rows) => {
    const { meta } = result;
    if (!meta.target || meta.targetIsConstant || meta.targetIsIdentifier) return;

    leakRunRef.current?.abort();
    const run = new AbortController();
    leakRunRef.current = run;
    setLeakageStatus("loading");
    setLeakageFailure(null);

    requestAi("leakage", buildLeakagePayload(result, dossier), run.signal, analysisId).then((reply) => {
      if (reply.aborted) return;
      applyUsage(reply.usage);
      const verified = reply.error ? null : verifyLeakage(reply.result, { data: rows, result });
      if (reply.error || verified.error) {
        setLeakageFailure({ error: reply.error ?? verified.error, detail: reply.detail });
        setLeakageStatus("error");
        return;
      }
      setLeakageReview({ ...verified, model: reply.model });
      setLeakageStatus("idle");
    });
  };

  /* A function declaration, not a const arrow: the one effect above calls it on
     mount to auto-start a dropped file, and a declaration is hoisted, so that
     reference is valid rather than a temporal-dead-zone read. */
  function startAnalysis(selectedTarget, rules) {
    setTarget(selectedTarget);
    // A review of the previous report, and any request still fetching one, are both stale.
    leakRunRef.current?.abort();
    setLeakageReview(null);
    setLeakageStatus("idle");
    setLeakageFailure(null);
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
        /* Started here, in the same handler that produced the report, rather than in
           an effect watching `step` — see the note on the one useEffect above.
           Only for a signed-in user with quota left: an automatic request that can
           only come back 401 or 402 would put an error on a report nobody asked to
           spend anything on. The server decides for real either way. */
        if (aiOptedIn && hasQuota(session)) runLeakageReview(result, rows);
      }, remaining);
    });
  }

  const handleTargetConfirmed = (selectedTarget) => startAnalysis(selectedTarget, acceptedRules);
  const handleApplyCleaning   = (rules) => {
    setAcceptedRules(rules);
    startAnalysis(target, rules);
  };

  /* Cancelled is not failed: back to the target picker with the chosen target
     kept, so the user can start again or pick a different one. */
  const handleCancel = () => {
    runRef.current?.abort();
    setStep("target");
  };

  const handleReset = () => navigate("/");

  return (
    /* Same `.night` scope as Home — see the gotcha in CLAUDE.md. A plain canvas:
       the dotted texture belongs to Home's drop zone only. */
    <div className="night min-h-screen bg-paper text-ink">
      <Header />

      <main className="pt-16">
        <AnimatePresence mode="wait">

          {step === "target" && (
            <motion.div key="target" {...stepVariants}>
              <TargetStep
                columns={columns}
                csvData={csvData}
                encoding={entry?.encoding}
                initialTarget={target}
                onConfirm={handleTargetConfirmed}
                onBack={analysisResult ? () => setStep("results") : handleReset}
                returning={Boolean(analysisResult)}
                ai={{
                  dossier, onDossier: setDossier,
                  roleOverrides, onRoleOverridesChange: setRoleOverrides,
                  cleaning, onCleaning: setCleaning,
                  acceptedRules, onAcceptedRulesChange: setAcceptedRules,
                  onOptIn: () => setAiOptedIn(true),
                  analysisId, onUsage: applyUsage,
                }}
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
              <div className="mx-auto max-w-2xl px-6 py-16 sm:py-24">
                <div className="rounded-2xl border border-line bg-paper-sunken p-6 sm:p-8">
                  <div className="flex items-center gap-2 text-[13px] font-medium text-critical">
                    <TriangleAlert size={14} className="shrink-0" />
                    Failed
                  </div>
                  <h1 className="mt-4 text-[1.5rem] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-3xl">
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
                  onChangeTarget={() => setStep("target")}
                  ai={{
                    data: analysisData, originalData: csvData, dossier, onDossier: setDossier,
                    leakageReview, leakageStatus, leakageFailure,
                    onRunLeakage: () => runLeakageReview(analysisResult, analysisData),
                    onCancelLeakage: () => { leakRunRef.current?.abort(); setLeakageStatus("idle"); },
                    cleaning, onCleaning: setCleaning, cleaningRules, onApplyCleaning: handleApplyCleaning,
                    onOptIn: () => setAiOptedIn(true),
                    analysisId, onUsage: applyUsage,
                  }}
                />
              </Suspense>
            </motion.div>
          )}

        </AnimatePresence>
      </main>
      <Footer />
    </div>
  );
}

export default Analyze;
