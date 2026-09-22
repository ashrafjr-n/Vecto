import { useCallback, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Papa from "papaparse";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import {
  UploadCloud, LoaderCircle, TriangleAlert, ArrowRight, FileWarning,
} from "lucide-react";

import Header from "../components/layout/Header.jsx";
import Footer from "../components/layout/Footer.jsx";
import SectionLabel from "../components/common/SectionLabel.jsx";
import { setPendingDataset } from "../lib/datasetHandoff.js";
import {
  validateFile, inspectParseResult, MAX_SIZE_MB, transformHeader, headerlessVerdict, headerlessRows, decodeCsv,
} from "../lib/csvIntake.js";

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

/* Three facts about the product, not live data — each one checkable. */
const DIAGNOSTICS = [
  { value: "8",                   label: "Report sections" },
  { value: "0",                   label: "Rows uploaded" },
  { value: `${MAX_SIZE_MB} MB`,   label: "Largest file" },
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
    title: "Your file stays in the browser",
    text: "Parsing and every computation run in this tab, and the file is never uploaded. The optional AI review sends column summaries only, and only when you ask for it.",
  },
  {
    title: "Every number comes with its reason",
    text: "A coefficient carries its p-value and sample size, a capped score says what capped it, and a column the engine could not measure is named as unmeasured — never shown as clean.",
  },
];

/* What the intake actually does with an awkward file — the three questions worth
   answering at the moment someone is choosing which file to drag, and nowhere
   else on the page. Each one describes real behaviour in lib/csvIntake.js:
   headerlessVerdict, decodeCsv and inspectParseResult. */
const INTAKE_NOTES = [
  {
    title: "The header row",
    text: "The first row becomes the column names. If it looks like data, you are asked which it is.",
  },
  {
    title: "Encoding",
    text: "UTF-8, or Windows-1252 when the bytes are not valid UTF-8, so accented headers survive.",
  },
  {
    title: "Rows that do not line up",
    text: "Lines that do not match the header's column count are counted and named, never dropped.",
  },
];

const PROCESS_FLOW = [
  { title: "Drop a CSV",         desc: "It is parsed in this tab. Nothing is uploaded." },
  { title: "Choose the target",  desc: "Or none. Column roles are read from the values, not the names." },
  { title: "Read the report",    desc: "Eight sections, each figure stated with the reasoning behind it." },
  { title: "Take the pipeline",  desc: "A scikit-learn script that repeats the preparation the report recommends." },
];

const DIAGNOSTIC_LAYERS = [
  { title: "Overview",        text: "Health score, column roles, key findings and prioritised recommendations." },
  { title: "Quality",         text: "Missing values, duplicates, mixed types and a quality score built from its deductions." },
  { title: "Statistics",      text: "Mean, median, spread, skewness, kurtosis and skew-adjusted outliers per column." },
  { title: "Visualizations",  text: "Histograms, box plots and level counts for every column." },
  { title: "Target signal",   text: "Each column against the target, with the metric that fits its type, and leakage checks." },
  { title: "Relationships",   text: "Correlation heatmap, redundant pairs and associations between categories." },
  { title: "Class balance",   text: "Class shares and imbalance, for a target with classes." },
  { title: "Preparation",     text: "A per-column plan, a baseline model as a measurement, and the script to run it." },
];

/* A real report, not a mock: seaborn's titanic.csv with `survived` as the target,
   as the engine reports it. Update from a real run if an engine change moves it. */
const SPECIMEN_INPUT = [
  { label: "Rows",     value: "891" },
  { label: "Columns",  value: "15" },
  { label: "Target",   value: "survived" },
];

const SPECIMEN_REPORT = [
  { label: "Leakage",        value: "alive restates the target (r = 1.00)" },
  { label: "Missing values", value: "deck is 77% empty — keep it as a present / absent flag" },
  { label: "Duplicates",     value: "107 rows — drop before training" },
];

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
  /* The page opens as three LAYERS, not three stacked blocks. The dotted canvas
     carrying the dropzone is pinned to the viewport (sticky, z-0); the hero sits
     on top of it (negative margin, z-10) and lifts away on scroll, uncovering a
     layer that was behind it the whole time; the content panel below (z-20) then
     rides up over that same pinned canvas. Two things fall out of it for free:
     every rounded panel corner now cuts through to the dots instead of to flat
     background, and the dots hold still while the panels move, which is what
     makes the depth read. All of it is scroll POSITION — nothing is timed, and
     scroll stays entirely in the user's hands. */
  const heroRef = useRef(null);
  const reduceMotion = useReducedMotion();
  const { scrollYProgress: heroExit } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });
  /* Transforms only, no scroll-linked opacity: framer-motion 12 updates a
     transform on every scroll frame but leaves a motion-value opacity frozen at
     the value it mounted with (measured here, both on the hero and on the
     dropzone). The reveal reads better for it — the hero stays a solid sheet
     rather than dissolving over the layer it is uncovering. */
  const heroY     = useTransform(heroExit, [0, 1], [0, -70]);
  const heroScale = useTransform(heroExit, [0, 1], [1, 0.97]);
  /* The canvas rises into place as the hero clears it — travel only, no scaling:
     a box that grows reads as a zoom, a box that comes up from below reads as the
     layer it is. The three blocks travel different distances, which is what makes
     the band read as depth rather than as one sheet sliding. */
  const headY = useTransform(heroExit, [0.15, 0.95], [60, 0]);
  const dropY = useTransform(heroExit, [0.15, 0.95], [120, 0]);
  const railY = useTransform(heroExit, [0.15, 0.95], [190, 0]);
  const heroMotion = reduceMotion ? undefined : { y: heroY, scale: heroScale };
  const headMotion = reduceMotion ? undefined : { y: headY };
  const dropMotion = reduceMotion ? undefined : { y: dropY };
  const railMotion = reduceMotion ? undefined : { y: railY };
  const [isDragOver, setIsDragOver] = useState(false);
  const [isParsing,  setIsParsing]  = useState(false);
  const [error,      setError]      = useState(null);
  /* Set when the CSV parsed but some rows were ragged — a warning, not a
     rejection: the readable rows are already handed off and analysable. */
  const [malformed,  setMalformed]  = useState(null);
  /* Set when the first row looks like data, not names — held for a choice,
     because the rule reads values and cannot be certain. Carries the decoded text
     so "read it as data" can re-parse, and the header parse's own malformed
     verdict for the "keep as names" path. */
  const [headerless, setHeaderless] = useState(null);

  /* The one exit after a successful parse: a ragged-row warning holds the
     navigation so it is read; otherwise go straight to the analysis. */
  const proceed = useCallback((malformedRows) => {
    if (malformedRows) {
      setIsParsing(false);
      setMalformed(malformedRows);
      return;
    }
    navigate("/analyze");
  }, [navigate]);

  const readFirstRowAsData = () => {
    const { text, encoding } = headerless;
    setHeaderless(null);
    setIsParsing(true);
    Papa.parse(text, {
      header:         false,
      skipEmptyLines: true,
      complete: (results) => {
        const { data, fields, malformed: ragged } = headerlessRows(results.data);
        setPendingDataset(data, fields, encoding);
        proceed(ragged);
      },
    });
  };

  const keepFirstRowAsNames = () => {
    const { malformed: ragged } = headerless;
    setHeaderless(null);
    proceed(ragged);
  };

  const handleFile = useCallback((file) => {
    if (!file) return;
    const err = validateFile(file);
    if (err) { setError(err); return; }

    setError(null);
    setMalformed(null);
    setHeaderless(null);
    setIsParsing(true);

    const readFailed = () => {
      setIsParsing(false);
      setError("parse");
    };

    /* Decoded here, not by PapaParse: a Latin-1 file read as UTF-8 turns every
       accented header into replacement characters (decodeCsv in csvIntake.js). */
    file.arrayBuffer().then((bytes) => {
      const { text, encoding } = decodeCsv(bytes);
      Papa.parse(text, {
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

          setPendingDataset(results.data, results.meta.fields, encoding);

          /* A headerless file used to lose its first row into the column names
             without a word. Ask before anything else: which row is the header
             decides which rows count as ragged. */
          const firstRowIsData = headerlessVerdict(results);
          if (firstRowIsData) {
            setIsParsing(false);
            setHeaderless({ ...firstRowIsData, text, encoding, malformed });
            return;
          }

          /* Rows PapaParse could not read cleanly. They were previously ignored
             outright — the file analyzed silently and every statistic downstream
             was computed over partly-garbage rows the user never saw. Hold the
             navigation so the warning is actually read; the data is already
             handed off, so continuing is one click. */
          proceed(malformed);
        },
      });
    }, readFailed);
  }, [proceed]);

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

      <main className="relative">

        {/* ── LAYER 0 — the dotted canvas, pinned to the viewport for the whole
            page. It is uncovered by the hero above it and then covered again by
            the content panel below, so it is also what shows through every
            rounded corner on the page. ─────────────────────────────────── */}
        <section className="sticky top-0 z-0 flex h-[100svh] items-center justify-center overflow-hidden px-6 pt-16 sm:px-10">
          <div aria-hidden className="dot-grid pointer-events-none absolute inset-0" />

          <div className="relative w-full max-w-4xl">

            <motion.h2
              style={headMotion}
              className="text-center text-[15px] font-medium text-ink-soft"
            >
              Start with a file. It is read here, in this tab.
            </motion.h2>

            <motion.div style={dropMotion} className="mx-auto mt-6 w-full max-w-2xl sm:mt-8">

            <div
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onClick={() => !isParsing && inputRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center rounded-[2rem] border px-8 py-10 text-center transition-colors sm:py-20 ${
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

            <p className="mt-6 text-center text-[13px] text-ink-faint">
              CSV up to {MAX_SIZE_MB} MB · processed in your browser ·{" "}
              <Link to="/analyze?sample=1" onClick={() => window.scrollTo(0, 0)} className="font-medium text-ink-soft underline decoration-line-strong underline-offset-4 hover:text-ink">
                or open a sample report
              </Link>
            </p>

            {headerless && (
              <div className="mt-6 rounded-2xl border border-warning/25 bg-warning-tint px-5 py-4">
                <div className="flex items-start gap-3">
                  <FileWarning size={16} className="mt-0.5 shrink-0 text-warning" />
                  <div>
                    <div className="text-[13px] font-semibold text-warning">
                      The first row looks like data, not column names.
                    </div>
                    <div className="mt-1 text-[13px] leading-relaxed text-ink-soft">
                      {headerless.dataLike} of its {headerless.total} cells are decimal or
                      negative numbers, which a column name almost never is. Read as names, that
                      row would be left out of every statistic. Read as data, the columns are
                      named column_1 to column_{headerless.total}.
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={readFirstRowAsData}
                    className="rounded-xl bg-ink px-4 py-2.5 text-[13px] font-semibold text-paper-sunken transition-opacity hover:opacity-90"
                  >
                    Read the first row as data
                  </button>
                  <button
                    type="button"
                    onClick={keepFirstRowAsNames}
                    className="rounded-xl border border-line-strong px-4 py-2.5 text-[13px] font-semibold text-ink transition-colors hover:border-ink-faint"
                  >
                    Keep it as column names
                  </button>
                </div>
              </div>
            )}

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

            {/* What the intake does with an awkward file, answered where the file is
                chosen — and what fills a band that was otherwise all negative space. */}
            <motion.dl
              style={railMotion}
              className="mt-9 grid gap-x-10 gap-y-4 border-t border-line pt-5 sm:mt-14 sm:gap-y-5 sm:pt-6 sm:grid-cols-3"
            >
              {INTAKE_NOTES.map((note) => (
                <div key={note.title}>
                  <dt className="text-[13.5px] font-medium tracking-tight text-ink">{note.title}</dt>
                  <dd className="mt-1.5 text-[12.5px] leading-[1.7] text-ink-soft">{note.text}</dd>
                </div>
              ))}
            </motion.dl>

          </div>
        </section>

        {/* ── LAYER 1 — HERO PANEL, lying over the pinned canvas and lifting off
            it on scroll. Its bottom radius cuts through to the dots. ────── */}
        <motion.section
          ref={heroRef}
          style={heroMotion}
          className={`relative z-10 -mt-[100svh] flex min-h-[100svh] origin-top flex-col justify-center bg-paper-sunken px-6 pt-24 pb-14 sm:px-10 sm:pt-28 sm:pb-16 ${PANEL_RADIUS_BOTTOM}`}
        >
          <div className="mx-auto max-w-[1400px]">

            <SectionLabel>Dataset analysis in the browser</SectionLabel>

            <h1 className="mt-12 max-w-[19ch] text-[2.5rem] font-semibold leading-[1.03] tracking-[-0.035em] text-ink sm:text-6xl lg:text-[5.25rem]">
              A structural audit of your dataset, in the browser.
            </h1>

            <div className="mt-16 grid gap-x-16 gap-y-10 border-t border-line pt-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <p className="max-w-2xl text-[16px] leading-[1.7] text-ink-soft">
                Drop a CSV and choose the column you want to predict. Vecto reads each
                column&apos;s role, measures quality, relationships and leakage, and tells you
                what to fix before training.
              </p>
              <p className="max-w-2xl text-[16px] leading-[1.7] text-ink-soft">
                The analysis runs in this tab and your file is never uploaded. An optional
                AI review sends column summaries — never rows — and only when you ask.
              </p>
            </div>

            <div className="mt-12 grid grid-cols-3 border-t border-line sm:mt-16">
              {DIAGNOSTICS.map((d) => (
                <div key={d.label} className="py-6 pr-4 sm:py-8 sm:pr-8">
                  <div className="whitespace-nowrap font-mono text-2xl font-medium tracking-tight text-ink sm:text-5xl">{d.value}</div>
                  <div className="mt-2 text-[13px] text-ink-faint">{d.label}</div>
                </div>
              ))}
            </div>

          </div>
        </motion.section>

        {/* ── THE REVEAL WINDOW — no content of its own: this is the stretch of
            scroll where the pinned canvas above is the only thing on screen and
            the dropzone is there to be used. ───────────────────────────── */}
        <div aria-hidden className="h-[145svh]" />

        {/* ── LAYER 2 — CONTENT PANEL, riding up over the pinned canvas. Mirrored
            radii, so its top corners cut through to the same dots. ─────── */}
        <section className={`relative z-20 bg-paper-sunken px-6 pt-20 pb-24 sm:px-10 sm:pt-28 sm:pb-32 ${PANEL_RADIUS_TOP}`}>
          <div className="mx-auto max-w-[1400px]">

            <motion.div {...REVEAL}>
              <SectionLabel>Why it can be trusted</SectionLabel>
              <div className="mt-10 grid gap-x-14 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
                {TALKING_POINTS.map((p) => (
                  <div key={p.title}>
                    <h3 className="text-[17px] font-medium leading-snug tracking-tight text-ink">{p.title}</h3>
                    <p className="mt-3 text-[13.5px] leading-[1.75] text-ink-soft">{p.text}</p>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div {...REVEAL} className="mt-24 sm:mt-32">
              <SectionLabel>How it works</SectionLabel>
              <ol className="mt-10 grid grid-cols-1 border-t border-line sm:grid-cols-2 lg:grid-cols-4">
                {PROCESS_FLOW.map((step, i) => (
                  <li key={step.title} className="border-b border-line py-7 pr-8 lg:border-b-0">
                    <div className="text-[13px] text-ink-faint">Step {i + 1}</div>
                    <div className="mt-2 text-[17px] font-medium tracking-tight text-ink">{step.title}</div>
                    <div className="mt-2 text-[13.5px] leading-[1.7] text-ink-soft">{step.desc}</div>
                  </li>
                ))}
              </ol>

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
              <SectionLabel>The report</SectionLabel>
              <div className="mt-10 grid gap-x-16 gap-y-6 lg:grid-cols-2 lg:items-end">
                <h2 className="max-w-[18ch] text-[1.75rem] font-semibold leading-[1.1] tracking-[-0.03em] text-ink sm:text-4xl">
                  Eight sections, one reading of the file.
                </h2>
                <p className="max-w-xl text-[15px] leading-[1.7] text-ink-soft">
                  Every section is computed from the same parse, so a column flagged in one is
                  the same column everywhere else — and the advice never contradicts itself.
                </p>
              </div>
              <div className="mt-14 grid gap-x-12 sm:grid-cols-2 lg:grid-cols-4">
                {DIAGNOSTIC_LAYERS.map((layer) => (
                  <div key={layer.title} className="border-t border-line pt-6 pb-10">
                    <div className="text-[17px] font-medium tracking-tight text-ink">{layer.title}</div>
                    <p className="mt-2 max-w-sm text-[13.5px] leading-[1.7] text-ink-soft">{layer.text}</p>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div {...REVEAL} className="mt-24 sm:mt-32">
              <SectionLabel>An example</SectionLabel>
              {/* A real run, as one recessed specimen: hairline rows and a large mono
                  figure — the hero's stat grammar. See SPECIMEN_* for where it comes from. */}
              <div className="mt-12 grid divide-y divide-line overflow-hidden rounded-[2rem] border border-line bg-paper lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:divide-x lg:divide-y-0">

                <div className="p-8 sm:p-10">
                  <div className="text-[13px] text-ink-faint">Input</div>
                  <div className="mt-6 break-all font-mono text-3xl font-medium tracking-tight text-ink sm:text-4xl">titanic.csv</div>
                  <dl className="mt-10 border-t border-line">
                    {SPECIMEN_INPUT.map((row) => (
                      <div key={row.label} className="flex items-baseline justify-between gap-6 border-b border-line py-4">
                        <dt className="text-[13.5px] text-ink-soft">{row.label}</dt>
                        <dd className="font-mono text-[13px] text-ink">{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>

                <div className="p-8 sm:p-10">
                  <div className="text-[13px] text-ink-faint">Report</div>
                  <div className="mt-6 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-mono text-5xl font-medium tracking-tight text-warning sm:text-6xl">69</span>
                    <span className="text-[13px] text-ink-faint">/100 health score · Fair, held down by the 77%-empty column</span>
                  </div>
                  <dl className="mt-10 border-t border-line">
                    {SPECIMEN_REPORT.map((row) => (
                      <div key={row.label} className="flex flex-col gap-1 border-b border-line py-4 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
                        <dt className="shrink-0 text-[13.5px] text-ink-soft">{row.label}</dt>
                        <dd className="text-[13px] text-ink sm:text-right">{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>

              </div>

              <div className="mt-16 flex flex-col gap-6 border-t border-line pt-12 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[15px] leading-relaxed text-ink-soft">
                  See the full report on a sample file, or read how every number is computed.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Link to="/analyze?sample=1" onClick={() => window.scrollTo(0, 0)} className="rounded-xl bg-ink px-5 py-2.5 text-[13px] font-semibold text-paper transition-opacity hover:opacity-90">
                    Open the sample report
                  </Link>
                  <Link to="/methodology" onClick={() => window.scrollTo(0, 0)} className="rounded-xl border border-line-strong px-5 py-2.5 text-[13px] font-semibold text-ink transition-colors hover:border-ink-faint">
                    Methodology
                  </Link>
                </div>
              </div>
            </motion.div>

          </div>
        </section>

      </main>

      <Footer />
    </div>
  );
}

export default Home;
