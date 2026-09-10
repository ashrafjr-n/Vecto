# Datassert

Know your dataset before you train on it.

Datassert is a browser-based CSV dataset analyzer. Upload a CSV, pick a target column, and
get a full readiness report: data quality, per-column statistics, correlations, class
balance, a 0–100 health score, and prioritized recommendations.

**Every byte of analysis runs in your browser.** No upload, no server, no AI — your data 
never leaves your machine.

## Features

- **Data quality** — missing cells, duplicate rows, constant columns, per-column issue list
- **Statistics** — mean, median, sample standard deviation, skewness, excess kurtosis,
  quartiles and outlier counts for every numeric column
- **Column roles** — automatic classification into numeric, categorical, binary,
  identifier, and temporal, with identifier-vs-numeric and date-detection heuristics
- **Relationships** — Pearson correlation matrix, Cramér's V for categorical pairs,
  correlation ratio (η), multicollinearity and target-leakage warnings, feature clusters
- **Missingness as signal** — whether a column was recorded at all is measured against
  the target, so a mostly-empty column whose absence tracks the label is reported rather
  than discarded
- **Nothing dropped silently** — any column the target scan cannot score is listed with
  the reason, and values excluded to keep a column numeric are counted and shown
- **Class balance** — class distribution for a classification target, including an explicit
  missing-value bucket and minority-class sizing
- **Health score** — a weighted 0–100 score across quality, structure, relationships, and
  target readiness, with a letter grade and per-dimension breakdown
- **Recommendations** — prioritized, human-readable next steps for making the dataset
  ML-ready

## Getting started

Requires Node.js 20+.

```bash
npm install
npm run dev
```

The dev server prints a local URL. No environment variables and no backend service are
required — the app is fully static.

### Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the Vite dev server with HMR |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the built output locally |
| `npm run lint` | Run ESLint over the project |

Ad-hoc dataset reports (no npm script — it takes file arguments):

```bash
node tools/report.mjs data/*.csv [--target=Col] [--out=reports]
```

Parses each CSV exactly as the app does, runs the analysis engine over it, and
writes the full `analyzeDataset()` output to `reports/<name>.json` — one file per
dataset, so a result can be diffed or re-read later. Written for testing the
engine against many datasets; it is not part of the shipped app.

## Tests

The analysis engine has a dependency-free regression suite that runs on plain Node:

```bash
npm test
```

This runs two files:

- **`tests/phase0.test.mjs`** — statistical correctness. Results are asserted against a
  Python reference (pandas/scipy) rather than hand-written expectations.
  `tests/reference/generate_reference.py` produces `tests/reference/expected.json` from the
  fixture CSVs in `tests/reference/datasets/`; the JS implementation is checked against it
  to a 1e-6 tolerance. Role detection, which has no Python equivalent, is asserted against
  intended-role maps declared in the test file itself.
- **`tests/engine-contract.test.mjs`** — the **output shape** of `analyzeDataset()`: the
  exact key set of the top-level result and of every nested object/array-element (`meta`,
  `quality`, `statistics[]`, `visualizations[]`, `relationships`, `classBalance`,
  `insights[]`, `healthScore`, `recommendations[]`). This is the contract a UI is built
  against — it exists so a frontend rewrite (or any new consumer) can trust the engine's
  shape without re-deriving it from source, and so a future change to the engine that
  breaks that shape fails here instead of silently.

Run `npm test` after any change under `src/components/utils/core/`.

## Project structure

```text
src/
  App.jsx                     routes: / (upload), /analyze (target → processing → results)
  lib/
    datasetHandoff.js         Home -> Analyze handoff (module singleton, not router state)
  pages/
    Home.jsx                  intro + the functional CSV dropzone
    Analyze.jsx                3-step machine: Target → Processing → Results
  components/
    layout/Header.jsx         fixed, full-width, shared by every page
    common/                   shared primitives (ErrorBoundary)
    analyze/
      shared/                 primitives used across steps/tabs (RolePill, StatTile,
                               SectionCard, StatusBadge, correlationColor)
      TargetStep/              target-column picker
      ResultsDashboard/        tabbed report (Overview/Quality/Statistics/
                                Visualizations/Relationships/Class Balance)
    utils/core/                the analysis engine (pure functions, no side effects)
      roles.constants.js      ROLE enum — the single source of truth for role strings
      index.js                analyzeDataset() orchestrator
      detectors/              column-role classification, target guessing
      analyzers/              quality, statistics, relationships
      scoring/                health score
      intelligence/           insights and recommendations
      helpers.js              shared numeric utilities
tests/                        analysis-engine regression suite + output-shape contract
```

## Tech stack

React 19 · Vite 8 · React Router 7 · Tailwind CSS 4 (CSS-first config, no
`tailwind.config.js`) · Framer Motion · PapaParse · lucide-react

Routes are code-split with `React.lazy`, and the results dashboard loads as its own
chunk only once an analysis finishes.

## Privacy

Datassert has no backend. CSV parsing and every statistic are computed client-side in
JavaScript; nothing is transmitted, stored, or logged anywhere.

## License

Private project. All rights reserved.

<!-- tV1 -->

<!-- tV2 -->

<!-- tV3 -->

<!-- tV4 -->

<!-- tV5 -->

<!-- tV6 -->

<!-- tV7 -->

<!-- tV8 -->

<!-- tV9 -->

<!-- tV10 -->

<!-- tV11 -->

<!-- tV12 -->

<!-- tV13 -->

<!-- tV14 -->

<!-- tV15 -->

<!-- tV16 -->

<!-- tV17 -->

<!-- tV18 -->

<!-- tV19 -->

<!-- tV20 -->

<!-- tV21 -->

<!-- tV22 -->

<!-- tV23 -->

<!-- tV24 -->

<!-- tV25 -->

<!-- tV26 -->

<!-- tV27 -->

<!-- tV28 -->

<!-- tV29 -->
