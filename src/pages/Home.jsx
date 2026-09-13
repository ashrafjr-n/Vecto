import { useCallback, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Papa from "papaparse";
import {
  UploadCloud, LoaderCircle, TriangleAlert,
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

const index2 = (i) => String(i + 1).padStart(2, "0");

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

          </div>
        </section>

        {/* ── CONTENT PANEL — mirrored radii, interlocking with the hero ── */}
        <section className={`bg-paper-sunken px-6 pt-20 pb-24 sm:px-10 sm:pt-28 sm:pb-32 ${PANEL_RADIUS_TOP}`}>
          <div className="mx-auto max-w-[1400px]">

            <div>
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

            <div className="mt-24 sm:mt-32">
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
            </div>

            {/* Full width now that it no longer shares the row: the headline holds the
                left column and the list the right, so neither half sits beside a gap. */}
            <div className="mt-24 sm:mt-32">
              <SectionLabel mark="04">Six diagnostic layers</SectionLabel>
              <div className="mt-10 grid gap-x-16 gap-y-10 lg:grid-cols-2">
                <h2 className="max-w-[16ch] text-[1.75rem] font-semibold leading-[1.1] tracking-[-0.03em] text-ink sm:text-4xl">
                  One dataset, read six ways.
                </h2>
                <div className="border-t border-line">
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
            </div>

            <div className="mt-24 sm:mt-32">
              <SectionLabel mark="05">From raw CSV to clear decisions</SectionLabel>
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
                      <TrendingUp size={13} className="shrink-0 text-accent-ink" />
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
