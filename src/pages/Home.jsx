import { useCallback, useEffect, useRef, useState, forwardRef } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import Papa from "papaparse";
import {
  UploadCloud, LoaderCircle, TriangleAlert, ChevronDown,
  FlaskConical, Binary, ShieldCheck, Scale,
  Workflow, ListChecks, Network, Gauge, Split, Lightbulb,
  ScanSearch, TrendingUp, ArrowRight, BarChart3, PieChart,
  Laptop, FileWarning, CheckCircle2, Target, Boxes,
} from "lucide-react";

import Header from "../components/layout/Header.jsx";
import Footer from "../components/layout/Footer.jsx";
import { setPendingDataset } from "../lib/datasetHandoff.js";
import { validateFile, inspectParseResult, MAX_SIZE_MB } from "../lib/csvIntake.js";

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

/* Left column: grounded, checkable claims — not marketing adjectives. Every one
   of these is a fact about something specific in the engine, not a vibe. */
const TALKING_POINTS = [
  {
    icon: FlaskConical,
    title: "Validated against a reference implementation",
    text: "Every statistic — standard deviation, skewness, kurtosis — is checked against a Python/pandas/scipy reference to a 1e-6 tolerance, not hand-verified once and left alone.",
  },
  {
    icon: Binary,
    title: "Role detection, not column-name matching",
    text: "Numeric, categorical, identifier, and temporal roles are inferred from the values themselves — cardinality, uniqueness, date-family matching — with explicit guards against false positives like a 4-digit year read as a date.",
  },
  {
    icon: ShieldCheck,
    title: "Nothing leaves the browser",
    text: "Parsing and every computation run in this tab. There is no upload endpoint to misconfigure, because there is no upload.",
  },
  {
    icon: Scale,
    title: "Built for people who read a correlation matrix",
    text: "No dumbed-down thresholds, no hand-holding copy. If you know what target leakage or multicollinearity means, this tool assumes you do.",
  },
];

/* Right column: real documentation of how each phase actually works, sourced
   directly from the analysis engine's logic — expand-on-click, not a wall of
   text no one asked for. See frontend.md "Home" spec. */
const PROCESS_TOPICS = [
  {
    icon: Workflow,
    title: "Column role detection",
    text: "Each column is classified as identifier, numeric, categorical, binary, or temporal. Numeric-looking integers with very low cardinality (≤8 unique values, under 5% of rows) are reclassified as encoded categorical, so a country code stored as 1–5 isn't treated as a continuous measurement. Identifier columns need a uniqueness signal plus supporting evidence — a name hint or leading-zero codes — width and uniqueness alone are never enough on their own.",
  },
  {
    icon: ListChecks,
    title: "Missing values & duplicates",
    text: "Missing tokens are matched broadly — empty strings, NA, null, N/A, whitespace — and excluded from every downstream calculation, not just counted. Duplicate-row scanning runs on datasets up to 50,000 rows; past that it's skipped and reported as skipped, never silently shown as zero.",
  },
  {
    icon: Network,
    title: "Correlation methods",
    text: "Numeric pairs use Pearson correlation. Categorical pairs use Cramér's V. A numeric feature against a categorical target uses the correlation ratio (η). Pairs at |r| ≥ 0.9 are flagged as redundant; a feature correlated above that threshold with the target itself is flagged as possible leakage.",
  },
  {
    icon: Gauge,
    title: "Health score",
    text: "A single 0–100 score, weighted across four dimensions: quality (missing/duplicate/constant columns), structure (row-to-feature ratio, identifier leakage), relationships (multicollinearity, leakage), and target readiness (class balance, when a target is set). A dimension's own sub-weights renormalize when a check — like the duplicate scan — is skipped, rather than silently scoring it as passing.",
  },
  {
    icon: Split,
    title: "Class balance",
    text: "For a classification target, the majority-to-minority ratio is compared against a 3× threshold (or an 80% majority share) to flag imbalance. The minority class's absolute row count is called out separately — under 10 rows reads as critically few no matter what the percentage says.",
  },
  {
    icon: Target,
    title: "Target auto-detection",
    text: "When no target is chosen, the column is guessed in four passes: an exact name match against common labels (target, label, class, outcome, churn, survived, y, output…), then a binary column (0/1, yes/no, true/false — the last one found, since targets tend to sit at the end), then a low-cardinality column scanned from the end (≤5% unique values), and finally the last column in the file as a fallback.",
  },
  {
    icon: Boxes,
    title: "Feature clusters",
    text: "Beyond flagging single redundant pairs, columns are grouped: any column correlated at |r| ≥ 0.7 with two or more others is added to a cluster. Three or more clustered columns trigger a dimensionality-reduction suggestion, since dropping one flagged pair at a time misses that they're all measuring roughly the same thing.",
  },
  {
    icon: Lightbulb,
    title: "Recommendations",
    text: "Every finding becomes a prioritized action — drop a column, impute a specific way, investigate an outlier — tagged by category (Data Cleaning, Feature Selection, Feature Engineering, Modeling, Data Integrity) and priority, not a generic checklist.",
  },
];

/* Below-the-fold section: dense, document-like recap of the tool's process,
   scope, and guarantees — an academic reference page, not a marketing scroll.
   See frontend.md typography scale: nothing here needs hero-sized type. */
const PROCESS_FLOW = [
  { icon: UploadCloud,  title: "Upload CSV", desc: "Drop your CSV directly in the browser." },
  { icon: ScanSearch,   title: "Detect",     desc: "Automatically identify targets, numeric, categorical & ID columns." },
  { icon: FlaskConical, title: "Analyze",    desc: "Check quality, relationships, class balance and more." },
  { icon: Lightbulb,    title: "Understand", desc: "Get actionable insights and recommendations." },
  { icon: TrendingUp,   title: "Improve",    desc: "Apply the recommendations to raise the health score." },
];

const DIAGNOSTIC_LAYERS = [
  { icon: ShieldCheck, title: "Quality",         text: "Missing values, duplicate rows, and a weighted quality score." },
  { icon: BarChart3,   title: "Statistics",      text: "Per-column mean, std, skewness, kurtosis and distribution shape." },
  { icon: PieChart,    title: "Visualizations",  text: "Histograms and distribution charts for every column." },
  { icon: Network,     title: "Relationships",   text: "A full correlation matrix with multicollinearity and leakage checks." },
  { icon: Split,       title: "Class Balance",   text: "Majority-to-minority ratio and minority-class row counts." },
  { icon: Lightbulb,   title: "Recommendations", text: "Prioritized, actionable fixes tied to what was actually found." },
];

const TRUST_POINTS = [
  { icon: Laptop,       title: "Everything runs locally.",         text: "Your dataset never leaves the browser." },
  { icon: FlaskConical, title: "Validated calculations.",          text: "Statistics are checked against reference implementations." },
  { icon: Binary,       title: "Role detection based on data.",    text: "Columns are classified from their values, not just their names." },
  { icon: Gauge,        title: "No black-box score.",              text: "The health score is broken into Quality, Structure, Relationships and Target Readiness." },
];

function DatasetJourneySection() {
  return (
    <section className="mt-20 border-t border-line pt-14">

      {/* From raw CSV to clear decisions */}
      <h2 className="text-center text-xl font-semibold tracking-tight text-ink sm:text-2xl">
        From raw CSV to clear decisions
      </h2>
      <div className="mx-auto mt-8 max-w-3xl rounded-xl border border-line bg-paper-sunken p-6 sm:p-8">
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:justify-center sm:gap-8">

          <div className="flex flex-col items-center gap-2 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-line-strong bg-paper">
              <FileWarning size={26} className="text-ink-faint" />
            </div>
            <div className="font-mono text-[13px] text-ink-soft">messy.csv</div>
          </div>

          <ArrowRight size={20} className="rotate-90 shrink-0 text-ink-faint sm:rotate-0" />

          <div className="w-full max-w-xs rounded-xl border border-line bg-paper p-4">
            <div className="flex items-center justify-between border-b border-line pb-2.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Health Score</span>
              <span className="font-mono text-lg font-semibold text-success">
                92<span className="text-xs font-normal text-ink-faint">/100</span>
              </span>
            </div>
            <div className="mt-3 space-y-2 text-[12.5px] text-ink-soft">
              <div className="flex items-center gap-2">
                <TrendingUp size={13} className="shrink-0 text-gold-ink" />
                Top predictor: <span className="font-mono text-ink">eat-well?</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 size={13} className="shrink-0 text-success" />
                No missing values
              </div>
              <div className="flex items-center gap-2">
                <Lightbulb size={13} className="shrink-0 text-warning" />
                Drop ID before training
              </div>
            </div>
          </div>

        </div>

        <p className="mt-6 text-center text-[15px] font-medium text-ink">
          Stop staring at columns. Start understanding your dataset.
        </p>
      </div>

      {/* What happens to your dataset? */}
      <h2 className="mt-16 text-center text-xl font-semibold tracking-tight text-ink sm:text-2xl">
        What happens to your dataset?
      </h2>
      <div className="mx-auto mt-8 max-w-5xl">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-0">
          {PROCESS_FLOW.flatMap((step, i) => {
            const node = (
              <div key={`step-${step.title}`} className="flex items-start gap-3 sm:flex-1 sm:flex-col sm:items-center sm:px-2 sm:text-center">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line-strong bg-paper-sunken">
                  <step.icon size={16} className="text-gold-ink" />
                </div>
                <div className="sm:mt-1.5">
                  <div className="text-[13px] font-semibold text-ink">{step.title}</div>
                  <div className="mt-0.5 text-[12px] leading-relaxed text-ink-soft">{step.desc}</div>
                </div>
              </div>
            );
            if (i === PROCESS_FLOW.length - 1) return [node];
            const arrow = (
              <div key={`arrow-${step.title}`} className="flex items-center pl-[17px] sm:justify-center sm:pl-0 sm:pt-4">
                <ArrowRight size={14} className="shrink-0 rotate-90 text-ink-faint sm:rotate-0" />
              </div>
            );
            return [node, arrow];
          })}
        </div>
      </div>

      {/* One dataset. Six diagnostic layers. / Built for trustworthy analysis — side by side */}
      <div className="mx-auto mt-16 grid max-w-5xl grid-cols-1 gap-10 lg:grid-cols-2">
        <div>
          <h2 className="text-center text-xl font-semibold tracking-tight text-ink sm:text-2xl lg:text-left">
            One dataset. Six diagnostic layers.
          </h2>
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {DIAGNOSTIC_LAYERS.map((layer) => (
              <div key={layer.title} className="rounded-lg border border-line px-4 py-3.5">
                <div className="flex items-center gap-2">
                  <layer.icon size={15} className="shrink-0 text-gold-ink" />
                  <div className="text-[13px] font-semibold text-ink">{layer.title}</div>
                </div>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-soft">{layer.text}</p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2 className="text-center text-xl font-semibold tracking-tight text-ink sm:text-2xl lg:text-left">
            Built for trustworthy analysis
          </h2>
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {TRUST_POINTS.map((point) => (
              <div key={point.title} className="rounded-lg border border-line px-4 py-3.5">
                <div className="flex items-center gap-2">
                  <point.icon size={15} className="shrink-0 text-gold-ink" />
                  <div className="text-[13px] font-semibold text-ink">{point.title}</div>
                </div>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-soft">{point.text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

    </section>
  );
}

const TalkingPointsColumn = forwardRef(function TalkingPointsColumn(_props, ref) {
  return (
    <aside ref={ref} className="order-2 space-y-6 lg:order-1">
      <div className="text-[11px] font-semibold uppercase tracking-widest text-ink-faint">Why it's built this way</div>
      {TALKING_POINTS.map((p) => (
        <div key={p.title}>
          <div className="flex items-center gap-2">
            <p.icon size={15} className="shrink-0 text-gold-ink" />
            <div className="text-[13px] font-semibold text-ink">{p.title}</div>
          </div>
          <p className="mt-1.5 text-justify text-[12.5px] leading-relaxed text-ink-soft">{p.text}</p>
        </div>
      ))}
    </aside>
  );
});

/* Exactly one topic open at all times (never collapses to nothing) — clicking
   a row switches which one is open rather than toggling it closed. The box
   height is synced to match TalkingPointsColumn (see Home()'s ResizeObserver)
   so the two side columns read as a matched pair regardless of viewport. */
function ProcessTopicsColumn({ matchHeight }) {
  const [open, setOpen] = useState(0);
  return (
    <aside className="order-3 flex flex-col lg:order-3" style={matchHeight ? { height: matchHeight } : undefined}>
      <div className="mb-3 shrink-0 text-[11px] font-semibold uppercase tracking-widest text-ink-faint">How the analysis works</div>
      <div className="divide-y divide-line overflow-y-auto rounded-xl border border-line">
        {PROCESS_TOPICS.map((topic, i) => {
          const isOpen = open === i;
          return (
            <div key={topic.title}>
              <button
                type="button"
                onClick={() => setOpen(i)}
                className="flex w-full items-center gap-2.5 px-4 py-3 text-left"
              >
                <topic.icon size={15} className="shrink-0 text-ink-faint" />
                <span className="flex-1 text-[13px] font-medium text-ink">{topic.title}</span>
                <ChevronDown size={14} className={`shrink-0 text-ink-faint transition-transform ${isOpen ? "rotate-180" : ""}`} />
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
                    <div className="px-4 pb-4 pl-[34px] text-[12.5px] leading-relaxed text-ink-soft">
                      {topic.text}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </aside>
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

  /* Keeps "How the analysis works" the same height as "Why it's built this
     way" — both are dynamic-height content, so a fixed Tailwind height would
     drift the moment either list's copy changes. */
  const talkingPointsRef = useRef(null);
  const [matchHeight, setMatchHeight] = useState(null);

  useEffect(() => {
    const el = talkingPointsRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      setMatchHeight(entry.contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
    <div className="min-h-screen bg-paper text-ink">
      <Header />

      <main className="mx-auto max-w-[1500px] px-6 pb-24 pt-28 sm:px-10 sm:pt-32">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[240px_minmax(0,1fr)_300px] lg:gap-8">

          <TalkingPointsColumn ref={talkingPointsRef} />

          {/* Center — intro + upload, pulled close together */}
          <div className="order-1 lg:order-2">
            <div className="mx-auto max-w-2xl text-center">
              <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
                A structural and statistical audit of your dataset,
                computed entirely in the browser.
              </h1>
              <p className="mx-auto mt-6 text-[15px] leading-relaxed text-ink-soft">
                Upload a CSV and select a target column. Datassert returns column-role
                detection, missing-value and duplicate analysis, per-column statistics,
                a correlation matrix with multicollinearity and target-leakage checks,
                class-balance diagnostics, and a weighted health score. No file is
                uploaded to a server — parsing and analysis run locally, in this tab.
              </p>

              <div className="mt-8 flex items-center justify-center gap-8 border-y border-line py-4">
                {DIAGNOSTICS.map((d) => (
                  <div key={d.label} className="text-center">
                    <div className="font-mono text-xl font-semibold text-ink">{d.value}</div>
                    <div className="mt-1 text-[11px] uppercase tracking-wide text-ink-faint">{d.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Upload card — close under the intro, not vertically centered
                in leftover page space */}
            <div className="mx-auto mt-8 max-w-xl">
              <div
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                onClick={() => !isParsing && inputRef.current?.click()}
                className={`flex cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed px-8 py-14 text-center transition-colors ${
                  isDragOver ? "border-gold bg-gold-tint" : "border-line-strong bg-paper-sunken hover:border-ink-faint"
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
                    <LoaderCircle size={32} className="animate-spin text-gold-ink" />
                    <div className="mt-4 text-sm font-medium text-ink">Parsing file…</div>
                  </>
                ) : (
                  <>
                    <UploadCloud size={32} className="text-ink-faint" />
                    <div className="mt-4 text-[15px] font-medium text-ink">
                      {isDragOver ? "Drop to upload" : "Drag and drop a CSV file"}
                    </div>
                    <div className="mt-1 text-[13px] text-ink-faint">or click to browse</div>
                  </>
                )}
              </div>

              <p className="mt-4 text-center text-[12px] text-ink-faint">
                CSV only · Up to {MAX_SIZE_MB}MB · Processed locally, never uploaded
              </p>

              {malformed && (
                <div className="mt-4 rounded-lg border border-warning/25 bg-warning-tint px-4 py-3.5">
                  <div className="flex items-start gap-3">
                    <FileWarning size={16} className="mt-0.5 shrink-0 text-warning" />
                    <div>
                      <div className="text-[13px] font-semibold text-warning">
                        {malformed.count.toLocaleString()} row{malformed.count > 1 ? "s" : ""} could not be read cleanly.
                      </div>
                      <div className="mt-0.5 text-[13px] leading-relaxed text-ink-soft">
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
                    className="mt-3 w-full rounded-lg bg-ink px-4 py-2 text-[13px] font-semibold text-paper transition-opacity hover:opacity-90"
                  >
                    Analyze anyway
                  </button>
                </div>
              )}

              {error && (
                <div className="mt-4 flex items-start gap-3 rounded-lg border border-critical/20 bg-critical-tint px-4 py-3">
                  <TriangleAlert size={16} className="mt-0.5 shrink-0 text-critical" />
                  <div>
                    <div className="text-[13px] font-semibold text-critical">{ERRORS[error].title}</div>
                    <div className="text-[13px] text-ink-soft">{ERRORS[error].desc}</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <ProcessTopicsColumn matchHeight={matchHeight} />

        </div>

        <DatasetJourneySection />
      </main>

      <Footer />
    </div>
  );
}

export default Home;
