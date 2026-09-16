import { useCallback, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Papa from "papaparse";
import { motion, useScroll, useTransform } from "framer-motion";
import {
  UploadCloud, LoaderCircle, TriangleAlert, ArrowRight, FileWarning,
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
  { value: "0",   label: "Rows uploaded" },
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

/* The raw-CSV-to-report illustration. Same facts as before, now as rows. */
const SPECIMEN_INPUT = [
  { label: "Column roles",  value: "Unknown" },
  { label: "Target",        value: "Not chosen" },
  { label: "Data quality",  value: "Unmeasured" },
];

const SPECIMEN_REPORT = [
  { label: "Top predictor",  value: "eat-well?" },
  { label: "Missing values", value: "None" },
  { label: "Recommendation", value: "Drop ID before training" },
];

const index2 = (i) => String(i + 1).padStart(2, "0");

/* Shared, restrained reveal for section groups further down the page: fade
   and ease up a short distance, once, the first time each group is scrolled
   into view. One motion language reused everywhere beats a different trick
   per section. */
const REVEAL = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.5, ease: "easeOut" },
};

function Home() {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  /* The hero eases out — fading and drifting up slightly — as it scrolls
     past, instead of cutting off hard at the viewport edge. Purely visual;
     scroll stays entirely in the user's hands. */
  const heroRef = useRef(null);
  const { scrollYProgress: heroProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });
  const heroOpacity = useTransform(heroProgress, [0, 1], [1, 0.5]);
  const heroY = useTransform(heroProgress, [0, 1], [0, -32]);
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

        {/* ── HERO PANEL — normal scroll throughout. It fades and eases up
            slightly as it scrolls past instead of cutting off hard, the one
            piece of motion tied directly to scroll position. ────────────── */}
        <motion.section
          ref={heroRef}
          style={{ opacity: heroOpacity, y: heroY }}
          className={`bg-paper-sunken px-6 pt-20 pb-10 sm:px-10 sm:pt-24 sm:pb-12 ${PANEL_RADIUS_BOTTOM}`}
        >
          <div className="mx-auto max-w-[1400px]">

            <SectionLabel mark="01">Client-side dataset audit</SectionLabel>

            <h1 className="mt-12 max-w-[19ch] text-[2.5rem] font-semibold leading-[1.03] tracking-[-0.035em] text-ink sm:text-6xl lg:text-[5.25rem]">
              A structural audit of your dataset, in the browser.
            </h1>

            <div className="mt-16 grid gap-x-16 gap-y-10 border-t border-line pt-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <p className="max-w-2xl text-[16px] leading-[1.7] text-ink-soft">
                Upload a CSV and pick a target column. Vecto checks column roles, data
                quality, correlations and leakage, then returns a weighted health score.
              </p>
              <p className="max-w-2xl text-[16px] leading-[1.7] text-ink-soft">
                Nothing is uploaded — parsing and analysis run locally, in this tab. An
                optional AI assistant can send a column summary, never row data, only
                when you ask. Every number in the report carries its reasoning, and
                every score held back says why.
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

          </div>
        </motion.section>

        {/* ── DOTTED CANVAS — the negative space between the two panels, and
            where the actual interaction lives ──────────────────────────── */}
        <section className="dot-grid px-6 py-24 sm:px-10 sm:py-36">
          <motion.div {...REVEAL} className="mx-auto max-w-2xl">

            <div
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onClick={() => !isParsing && inputRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center rounded-[2rem] border px-8 py-20 text-center transition-colors sm:py-24 ${
                isDragOver
                  ? "border-accent bg-accent-tint"
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
                  <LoaderCircle size={28} className="animate-spin text-accent-ink" />
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

          </motion.div>
        </section>

        {/* ── CONTENT PANEL — mirrored radii, interlocking with the hero ── */}
        <section className={`bg-paper-sunken px-6 pt-20 pb-24 sm:px-10 sm:pt-28 sm:pb-32 ${PANEL_RADIUS_TOP}`}>
          <div className="mx-auto max-w-[1400px]">

            <motion.div {...REVEAL}>
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
            </motion.div>

            <motion.div {...REVEAL} className="mt-24 sm:mt-32">
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

              {/* The detail that used to be an accordion here lives on /methodology. */}
              <Link
                to="/methodology"
                onClick={() => window.scrollTo(0, 0)}
                className="mt-10 inline-flex items-center gap-2 text-[14px] font-medium text-ink-soft transition-colors hover:text-ink"
              >
                How each stage works — thresholds, estimators and limits
                <ArrowRight size={14} />
              </Link>
            </motion.div>

            {/* Headline and lead share the top row so neither half is empty; the six
                layers sit below as an even 3 × 2 grid, each cell opened by its own
                hairline — the stats row's grammar, not a list crowded into one column. */}
            <motion.div {...REVEAL} className="mt-24 sm:mt-32">
              <SectionLabel mark="04">Six diagnostic layers</SectionLabel>
              <div className="mt-10 grid gap-x-16 gap-y-6 lg:grid-cols-2 lg:items-end">
                <h2 className="max-w-[16ch] text-[1.75rem] font-semibold leading-[1.1] tracking-[-0.03em] text-ink sm:text-4xl">
                  One dataset, read six ways.
                </h2>
                <p className="max-w-xl text-[15px] leading-[1.7] text-ink-soft">
                  Each layer is a section of the report, computed from the same parse of the
                  file — so a column flagged in one layer is the same column everywhere else.
                </p>
              </div>
              <div className="mt-14 grid gap-x-12 sm:grid-cols-2 lg:grid-cols-3">
                {DIAGNOSTIC_LAYERS.map((layer, i) => (
                  <div key={layer.title} className="border-t border-line pt-6 pb-10">
                    <div className="font-mono text-[11px] text-ink-faint">{index2(i)}</div>
                    <div className="mt-4 text-[17px] font-medium tracking-tight text-ink">{layer.title}</div>
                    <p className="mt-2 max-w-sm text-[13.5px] leading-[1.7] text-ink-soft">{layer.text}</p>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div {...REVEAL} className="mt-24 sm:mt-32">
              <SectionLabel mark="05">From raw CSV to clear decisions</SectionLabel>
              {/* Before / after as one recessed specimen. Hairline rows and a large mono
                  figure — the hero's stat grammar — instead of icon badges in a card
                  nested inside a card. Static illustration, not live data. */}
              <div className="mt-12 grid divide-y divide-line overflow-hidden rounded-[2rem] border border-line bg-paper lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:divide-x lg:divide-y-0">

                <div className="p-8 sm:p-10">
                  <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink-faint">Input</div>
                  <div className="mt-8 font-mono text-3xl font-medium tracking-tight text-ink sm:text-4xl">messy.csv</div>
                  <dl className="mt-10 border-t border-line">
                    {SPECIMEN_INPUT.map((row) => (
                      <div key={row.label} className="flex items-baseline justify-between gap-6 border-b border-line py-4">
                        <dt className="text-[13.5px] text-ink-soft">{row.label}</dt>
                        <dd className="font-mono text-[13px] text-ink-faint">{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>

                <div className="p-8 sm:p-10">
                  <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink-faint">Report</div>
                  <div className="mt-8 flex items-baseline gap-3">
                    <span className="font-mono text-5xl font-medium tracking-tight text-success sm:text-6xl">92</span>
                    <span className="font-mono text-[13px] text-ink-faint">/100 · Health score · Excellent</span>
                  </div>
                  <dl className="mt-10 border-t border-line">
                    {SPECIMEN_REPORT.map((row) => (
                      <div key={row.label} className="flex items-baseline justify-between gap-6 border-b border-line py-4">
                        <dt className="text-[13.5px] text-ink-soft">{row.label}</dt>
                        <dd className="text-right font-mono text-[13px] text-ink">{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>

              </div>

              <p className="mt-16 max-w-[20ch] text-[2rem] font-semibold leading-[1.1] tracking-[-0.03em] text-ink sm:text-5xl">
                Stop staring at columns. Start understanding your dataset.
              </p>
            </motion.div>

          </div>
        </section>

      </main>

      <Footer />
    </div>
  );
}

export default Home;
