import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import Papa from "papaparse";
import {
  UploadCloud, LoaderCircle, TriangleAlert, ChevronDown,
  ArrowRight, FileWarning, CheckCircle2, TrendingUp, Lightbulb,
} from "lucide-react";

import Header from "../components/layout/Header.jsx";
import Footer from "../components/layout/Footer.jsx";
import SectionLabel from "../components/common/SectionLabel.jsx";
import { setPendingDataset } from "../lib/datasetHandoff.js";
import { validateFile, inspectParseResult, MAX_SIZE_MB, transformHeader } from "../lib/csvIntake.js";

/* Radius pair that makes the hero and the content panel read as one continuous
   surface interrupted by the dotted canvas, rather than two stacked cards.
   Defined once so the two halves of the interlock can never drift apart. */
const PANEL_RADIUS_BOTTOM = "rounded-b-[2.5rem] sm:rounded-b-[4.5rem] lg:rounded-b-[7rem]";
const PANEL_RADIUS_TOP    = "rounded-t-[2.5rem] sm:rounded-t-[4.5rem] lg:rounded-t-[7rem]";

const ERRORS = {
  format: {
    title: "Unsupported file format.",
    desc:  "Only CSV files are accepted.",
  },
  size: {
    title: "File exceeds the size limit.",
    desc:  `Maximum accepted size is ${MAX_SIZE_MB}MB.`,
  },
  parse: {
    title: "Unable to parse this file.",
    desc:  "The CSV structure could not be read — check for a header row and consistent columns.",
  },
};

/* Small stat row for dashboard-adjacent texture only — not live data. See
   frontend.md "Home" spec: atmosphere, never a fake dashboard. */
const DIAGNOSTICS = [
  { value: "10+", label: "Diagnostics computed" },
  { value: "6",   label: "Report sections" },
  { value: "0",   label: "Bytes sent to a server" },
];

/* Grounded, checkable claims — not marketing adjectives. Every one of these is
   a fact about something specific in the engine, not a vibe. */
const TALKING_POINTS = [
  {
    title: "Validated against a reference implementation",
    text: "Every statistic — standard deviation, skewness, kurtosis — is checked against a Python/pandas/scipy reference to a 1e-6 tolerance, not hand-verified once and left alone.",
  },
  {
    title: "Role detection, not column-name matching",
    text: "Numeric, categorical, identifier, and temporal roles are inferred from the values themselves — cardinality, uniqueness, date-family matching — with explicit guards against false positives like a 4-digit year read as a date.",
  },
  {
    title: "Nothing leaves the browser",
    text: "Parsing and every computation run in this tab. There is no upload endpoint to misconfigure, because there is no upload.",
  },
  {
    title: "Built for people who read a correlation matrix",
    text: "No dumbed-down thresholds, no hand-holding copy. If you know what target leakage or multicollinearity means, this tool assumes you do.",
  },
];

/* Real documentation of how each phase actually works, sourced directly from the
   analysis engine's logic — expand-on-click, not a wall of text no one asked
   for. See frontend.md "Home" spec. */
const PROCESS_TOPICS = [
  {
    title: "Column role detection",
    text: "Each column is classified as identifier, numeric, categorical, binary, or temporal. Numeric-looking integers with very low cardinality (≤8 unique values, under 5% of rows) are reclassified as encoded categorical, so a country code stored as 1–5 isn't treated as a continuous measurement. Identifier columns need a uniqueness signal plus supporting evidence — a name hint or leading-zero codes — width and uniqueness alone are never enough on their own.",
  },
  {
    title: "Missing values & duplicates",
    text: "Missing tokens are matched broadly — empty strings, NA, null, N/A, whitespace — and excluded from every downstream calculation, not just counted. Duplicate-row scanning runs on datasets up to 50,000 rows; past that it's skipped and reported as skipped, never silently shown as zero.",
  },
  {
    title: "Correlation methods",
    text: "Numeric pairs use Pearson correlation. Categorical pairs use Cramér's V. A numeric feature against a categorical target uses the correlation ratio (η). Pairs at |r| ≥ 0.9 are flagged as redundant; a feature correlated above that threshold with the target itself is flagged as possible leakage.",
  },
  {
    title: "Health score",
    text: "A single 0–100 score, weighted across four dimensions: quality (missing/duplicate/constant columns), structure (row-to-feature ratio, identifier leakage), relationships (multicollinearity, leakage), and target readiness (class balance, when a target is set). A dimension's own sub-weights renormalize when a check — like the duplicate scan — is skipped, rather than silently scoring it as passing.",
  },
  {
    title: "Class balance",
    text: "For a classification target, the majority-to-minority ratio is compared against a 3× threshold (or an 80% majority share) to flag imbalance. The minority class's absolute row count is called out separately — under 10 rows reads as critically few no matter what the percentage says.",
  },
  {
    title: "Target auto-detection",
    text: "When no target is chosen, the column is guessed in four passes: an exact name match against common labels (target, label, class, outcome, churn, survived, y, output…), then a binary column (0/1, yes/no, true/false — the last one found, since targets tend to sit at the end), then a low-cardinality column scanned from the end (≤5% unique values), and finally the last column in the file as a fallback.",
  },
  {
    title: "Feature clusters",
    text: "Beyond flagging single redundant pairs, columns are grouped: any column correlated at |r| ≥ 0.7 with two or more others is added to a cluster. Three or more clustered columns trigger a dimensionality-reduction suggestion, since dropping one flagged pair at a time misses that they're all measuring roughly the same thing.",
  },
  {
    title: "Recommendations",
    text: "Every finding becomes a prioritized action — drop a column, impute a specific way, investigate an outlier — tagged by category (Data Cleaning, Feature Selection, Feature Engineering, Modeling, Data Integrity) and priority, not a generic checklist.",
  },
];

const PROCESS_FLOW = [
  { title: "Upload CSV", desc: "Drop your CSV directly in the browser." },
  { title: "Detect",     desc: "Automatically identify targets, numeric, categorical & ID columns." },
  { title: "Analyze",    desc: "Check quality, relationships, class balance and more." },
  { title: "Understand", desc: "Get actionable insights and recommendations." },
  { title: "Improve",    desc: "Apply the recommendations to raise the health score." },
];

const DIAGNOSTIC_LAYERS = [
  { title: "Quality",         text: "Missing values, duplicate rows, and a weighted quality score." },
  { title: "Statistics",      text: "Per-column mean, std, skewness, kurtosis and distribution shape." },
  { title: "Visualizations",  text: "Histograms and distribution charts for every column." },
  { title: "Relationships",   text: "A full correlation matrix with multicollinearity and leakage checks." },
  { title: "Class Balance",   text: "Majority-to-minority ratio and minority-class row counts." },
  { title: "Recommendations", text: "Prioritized, actionable fixes tied to what was actually found." },
];

const TRUST_POINTS = [
  { title: "Everything runs locally.",      text: "Your dataset never leaves the browser." },
  { title: "Validated calculations.",       text: "Statistics are checked against reference implementations." },
  { title: "Role detection based on data.", text: "Columns are classified from their values, not just their names." },
  { title: "No black-box score.",           text: "The health score is broken into Quality, Structure, Relationships and Target Readiness." },
];

const index2 = (i) => String(i + 1).padStart(2, "0");

/* Exactly one topic open at all times (never collapses to nothing) — clicking a
   row switches which one is open rather than toggling it closed. */
function ProcessTopics() {
  const [open, setOpen] = useState(0);
  return (
    <div className="mt-10 border-t border-line">
      {PROCESS_TOPICS.map((topic, i) => {
        const isOpen = open === i;
        return (
          <div key={topic.title} className="border-b border-line">
            <button
              type="button"
              onClick={() => setOpen(i)}
              className="flex w-full items-center gap-5 py-5 text-left transition-colors sm:gap-8"
            >
              <span className="font-mono text-[11px] text-ink-faint">{index2(i)}</span>
              <span className={`flex-1 text-[17px] tracking-tight transition-colors sm:text-xl ${isOpen ? "text-ink" : "text-ink-soft"}`}>
                {topic.title}
              </span>
              <ChevronDown size={16} className={`shrink-0 text-ink-faint transition-transform ${isOpen ? "rotate-180" : ""}`} />
            </button>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  key="content"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: "easeInOut" }}
                  className="overflow-hidden"
                >
                  <p className="max-w-3xl pb-7 text-[14px] leading-[1.75] text-ink-soft sm:pl-[54px]">
                    {topic.text}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

function Home() {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isParsing,  setIsParsing]  = useState(false);
  const [error,      setError]      = useState(null);
  /* Set when the CSV parsed but some rows were ragged — a warning, not a
     rejection: the readable rows are already handed off and analysable. */
  const [malformed,  setMalformed]  = useState(null);

  const handleFile = useCallback((file) => {
    if (!file) return;
    const err = validateFile(file);
    if (err) { setError(err); return; }

    setError(null);
    setMalformed(null);
    setIsParsing(true);

    Papa.parse(file, {
      header:         true,
      skipEmptyLines: true,
      transformHeader,
      complete: (results) => {
        const { error: verdict, malformed } = inspectParseResult(results);
        if (verdict) {
          setIsParsing(false);
          setError(verdict);
          return;
        }

        setPendingDataset(results.data, results.meta.fields);

        /* Rows PapaParse could not read cleanly. They were previously ignored
           outright — the file analyzed silently and every statistic downstream
           was computed over partly-garbage rows the user never saw. Hold the
           navigation so the warning is actually read; the data is already
           handed off, so continuing is one click. */
        if (malformed) {
          setIsParsing(false);
          setMalformed(malformed);
          return;
        }
        navigate("/analyze");
      },
      error: () => {
        setIsParsing(false);
        setError("parse");
      },
    });
  }, [navigate]);

  const onDragOver  = (e) => { e.preventDefault(); setIsDragOver(true); };
  const onDragLeave = ()  => setIsDragOver(false);
  const onDrop      = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    handleFile(e.dataTransfer.files[0]);
  };

  return (
    <div className="night min-h-screen bg-paper text-ink">
      <Header />

      <main>

        {/* ── HERO PANEL — large surface, bottom corners curve away into the
            dotted canvas below it ───────────────────────────────────────── */}
        <section className={`bg-paper-sunken px-6 pt-28 pb-20 sm:px-10 sm:pt-36 sm:pb-28 ${PANEL_RADIUS_BOTTOM}`}>
          <div className="mx-auto max-w-[1400px]">

            <SectionLabel mark="01">Client-side dataset audit</SectionLabel>

            <h1 className="mt-12 max-w-[19ch] text-[2.5rem] font-semibold leading-[1.03] tracking-[-0.035em] text-ink sm:text-6xl lg:text-[5.25rem]">
              A structural audit of your dataset, in the browser.
            </h1>

            <div className="mt-16 grid gap-x-16 gap-y-10 border-t border-line pt-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <p className="max-w-2xl text-[16px] leading-[1.7] text-ink-soft">
                Upload a CSV and select a target column. Vecto returns column-role
                detection, missing-value and duplicate analysis, per-column statistics,
                a correlation matrix with multicollinearity and target-leakage checks,
                class-balance diagnostics, and a weighted health score.
              </p>
              <p className="max-w-2xl text-[16px] leading-[1.7] text-ink-soft">
                No file is uploaded to a server — parsing and analysis run locally, in
                this tab. The report is a statistical document, not a dashboard: every
                number arrives with the reasoning behind it, and every score that was
                held back says which piece of evidence held it.
              </p>
            </div>

            <div className="mt-16 grid grid-cols-1 border-t border-line sm:grid-cols-3">
              {DIAGNOSTICS.map((d) => (
                <div key={d.label} className="border-b border-line py-8 pr-8 sm:border-b-0">
                  <div className="font-mono text-4xl font-medium tracking-tight text-ink sm:text-5xl">{d.value}</div>
                  <div className="mt-3 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint">{d.label}</div>
                </div>
              ))}
            </div>

            <div className="mt-12 sm:mt-20">
              <SectionLabel mark="02">Why it's built this way</SectionLabel>
              <div className="mt-10 grid gap-x-14 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
                {TALKING_POINTS.map((p, i) => (
                  <div key={p.title}>
                    <div className="font-mono text-[11px] text-ink-faint">{index2(i)}</div>
                    <h3 className="mt-4 text-[17px] font-medium leading-snug tracking-tight text-ink">{p.title}</h3>
                    <p className="mt-3 text-[13.5px] leading-[1.75] text-ink-soft">{p.text}</p>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </section>

        {/* ── DOTTED CANVAS — the negative space between the two panels, and
            where the actual interaction lives ──────────────────────────── */}
        <section className="dot-grid px-6 py-24 sm:px-10 sm:py-36">
          <div className="mx-auto max-w-2xl">

            <div
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onClick={() => !isParsing && inputRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center rounded-[2rem] border px-8 py-20 text-center transition-colors sm:py-24 ${
                isDragOver
                  ? "border-gold bg-gold-tint"
                  : "border-line-strong bg-paper-sunken hover:border-ink-faint"
              }`}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => handleFile(e.target.files[0])}
              />

              {isParsing ? (
                <>
                  <LoaderCircle size={28} className="animate-spin text-gold-ink" />
                  <div className="mt-6 text-[17px] text-ink">Parsing file…</div>
                </>
              ) : (
                <>
                  <UploadCloud size={28} className="text-ink-faint" />
                  <div className="mt-6 text-[22px] font-medium tracking-tight text-ink sm:text-[26px]">
                    {isDragOver ? "Drop to upload" : "Drag and drop a CSV file"}
                  </div>
                  <div className="mt-2 text-[14px] text-ink-soft">or click to browse</div>
                </>
              )}
            </div>

            <p className="mt-6 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
              CSV only · Up to {MAX_SIZE_MB}MB · Processed locally, never uploaded
            </p>

            {malformed && (
              <div className="mt-6 rounded-2xl border border-warning/25 bg-warning-tint px-5 py-4">
                <div className="flex items-start gap-3">
                  <FileWarning size={16} className="mt-0.5 shrink-0 text-warning" />
                  <div>
                    <div className="text-[13px] font-semibold text-warning">
                      {malformed.count.toLocaleString()} row{malformed.count > 1 ? "s" : ""} could not be read cleanly.
                    </div>
                    <div className="mt-1 text-[13px] leading-relaxed text-ink-soft">
                      {malformed.totalRows.toLocaleString()} rows parsed. The affected lines
                      {" "}({malformed.sampleRows.join(", ")}
                      {malformed.count > malformed.sampleRows.length ? ", …" : ""}) have a
                      different column count than the header, usually from an unescaped comma
                      or quote. They are still analysed, so the report may be skewed.
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => navigate("/analyze")}
                  className="mt-4 w-full rounded-xl bg-ink px-4 py-2.5 text-[13px] font-semibold text-paper-sunken transition-opacity hover:opacity-90"
                >
                  Analyze anyway
                </button>
              </div>
            )}

            {error && (
              <div className="mt-6 flex items-start gap-3 rounded-2xl border border-critical/25 bg-critical-tint px-5 py-4">
                <TriangleAlert size={16} className="mt-0.5 shrink-0 text-critical" />
                <div>
                  <div className="text-[13px] font-semibold text-critical">{ERRORS[error].title}</div>
                  <div className="text-[13px] text-ink-soft">{ERRORS[error].desc}</div>
                </div>
              </div>
            )}

          </div>
        </section>

        {/* ── CONTENT PANEL — mirrored radii, interlocking with the hero ── */}
        <section className={`bg-paper-sunken px-6 pt-20 pb-24 sm:px-10 sm:pt-28 sm:pb-32 ${PANEL_RADIUS_TOP}`}>
          <div className="mx-auto max-w-[1400px]">

            <SectionLabel mark="03">What happens to your dataset</SectionLabel>
            <div className="mt-10 grid grid-cols-1 border-t border-line sm:grid-cols-2 lg:grid-cols-5">
              {PROCESS_FLOW.map((step, i) => (
                <div key={step.title} className="border-b border-line py-7 pr-8 lg:border-b-0">
                  <div className="font-mono text-[11px] text-ink-faint">{index2(i)}</div>
                  <div className="mt-4 text-[17px] font-medium tracking-tight text-ink">{step.title}</div>
                  <div className="mt-2 text-[13.5px] leading-[1.7] text-ink-soft">{step.desc}</div>
                </div>
              ))}
            </div>

            <div className="mt-24 sm:mt-32">
              <SectionLabel mark="04">How the analysis works</SectionLabel>
              <h2 className="mt-10 max-w-[24ch] text-[2rem] font-semibold leading-[1.08] tracking-[-0.03em] text-ink sm:text-5xl">
                Eight phases, each one documented.
              </h2>
              <ProcessTopics />
            </div>

            <div className="mt-24 grid gap-x-16 gap-y-20 sm:mt-32 lg:grid-cols-2">
              <div>
                <SectionLabel mark="05">Six diagnostic layers</SectionLabel>
                <h2 className="mt-10 max-w-[16ch] text-[1.75rem] font-semibold leading-[1.1] tracking-[-0.03em] text-ink sm:text-4xl">
                  One dataset, read six ways.
                </h2>
                <div className="mt-10 border-t border-line">
                  {DIAGNOSTIC_LAYERS.map((layer, i) => (
                    <div key={layer.title} className="flex items-baseline gap-5 border-b border-line py-5 sm:gap-8">
                      <span className="font-mono text-[11px] text-ink-faint">{index2(i)}</span>
                      <div>
                        <div className="text-[15px] font-medium tracking-tight text-ink">{layer.title}</div>
                        <p className="mt-1.5 text-[13.5px] leading-[1.7] text-ink-soft">{layer.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <SectionLabel mark="06">Trustworthy by construction</SectionLabel>
                <h2 className="mt-10 max-w-[16ch] text-[1.75rem] font-semibold leading-[1.1] tracking-[-0.03em] text-ink sm:text-4xl">
                  Nothing here is a black box.
                </h2>
                <div className="mt-10 border-t border-line">
                  {TRUST_POINTS.map((point, i) => (
                    <div key={point.title} className="flex items-baseline gap-5 border-b border-line py-5 sm:gap-8">
                      <span className="font-mono text-[11px] text-ink-faint">{index2(i)}</span>
                      <div>
                        <div className="text-[15px] font-medium tracking-tight text-ink">{point.title}</div>
                        <p className="mt-1.5 text-[13.5px] leading-[1.7] text-ink-soft">{point.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-24 sm:mt-32">
              <SectionLabel mark="07">From raw CSV to clear decisions</SectionLabel>
              <div className="mt-12 flex flex-col items-center gap-8 rounded-[2rem] border border-line px-6 py-12 sm:flex-row sm:justify-center sm:gap-12 sm:px-12">

                <div className="text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-line-strong">
                    <FileWarning size={22} className="text-ink-faint" />
                  </div>
                  <div className="mt-3 font-mono text-[12px] text-ink-soft">messy.csv</div>
                </div>

                <ArrowRight size={20} className="rotate-90 shrink-0 text-ink-faint sm:rotate-0" />

                <div className="w-full max-w-xs rounded-2xl border border-line px-5 py-4">
                  <div className="flex items-center justify-between border-b border-line pb-3">
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">Health Score</span>
                    <span className="font-mono text-xl font-medium text-success">
                      92<span className="text-xs text-ink-faint">/100</span>
                    </span>
                  </div>
                  <div className="mt-4 space-y-2.5 text-[13px] text-ink-soft">
                    <div className="flex items-center gap-2.5">
                      <TrendingUp size={13} className="shrink-0 text-gold-ink" />
                      Top predictor: <span className="font-mono text-ink">eat-well?</span>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <CheckCircle2 size={13} className="shrink-0 text-success" />
                      No missing values
                    </div>
                    <div className="flex items-center gap-2.5">
                      <Lightbulb size={13} className="shrink-0 text-warning" />
                      Drop ID before training
                    </div>
                  </div>
                </div>

              </div>

              <p className="mt-16 max-w-[20ch] text-[2rem] font-semibold leading-[1.1] tracking-[-0.03em] text-ink sm:text-5xl">
                Stop staring at columns. Start understanding your dataset.
              </p>
            </div>

          </div>
        </section>

      </main>

      <Footer />
    </div>
  );
}

export default Home;
