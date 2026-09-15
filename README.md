# Vecto

Know your dataset before you train on it.

Vecto is a browser-based CSV dataset analyzer. Upload a CSV, pick a target column, and
get a full readiness report: data quality, per-column statistics, correlations, class
balance, a 0–100 health score, and prioritized recommendations.

**Every byte of analysis runs in your browser.** No file is uploaded and no model computes
any part of the report. An optional AI assistant on the target picker can suggest what each
column means — it runs only when asked, sends a column summary you can inspect first, and
changes the report only when you accept a suggestion.

## Features

- **Data quality** — missing cells, duplicate rows, constant columns, per-column issue list
- **Statistics** — mean, median, sample standard deviation, skewness, excess kurtosis,
  quartiles and outlier counts for every numeric column
- **Column roles** — automatic classification into numeric, categorical, binary,
  identifier, temporal, and free text, read from whole columns rather than a head sample
- **Relationships** — Pearson and Spearman with two-sided p-values, bias-corrected
  Cramér's V for categorical pairs, a rank-based correlation ratio (η, Kruskal–Wallis) for
  numeric–categorical pairs, mutual information for
  non-monotonic signal, multicollinearity and target-leakage warnings, feature clusters
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
- **AI column review (optional)** — on the target picker, one request asks a language model
  to read a per-column summary and suggest what each column records, a finer subtype, a
  unit, a plausible range and the likely target, together with cleaning rules for the values
  the engine's scan found dirty (see cleaning proposals below). Every claim is checked against the file before it is shown: quoted values
  must exist, a suggested role the data contradicts is not offered, the plausible range is
  counted by the engine, and an unusable target is withheld. An accepted role becomes an
  explicit input to the analysis and is marked in the report; accepted cleaning rules are
  applied to the upload before the first analysis, so no re-run is needed.
- **AI leakage review (optional)** — on the Target Signal tab, a language model reads column
  names, roles and the engine's measured associations (no cell values) and names the
  columns a model could not use at prediction time: derived from the target, recorded after
  the outcome, the label under another name, or an entity repeated across rows — plus the
  split an honest evaluation needs. Every proposed formula is evaluated on the rows, and a
  total that differs only by a few fixed amounts (an unrecorded surcharge) is recognised as
  such; group claims are measured; timing claims are shown as questions. Advisory only.
- **AI cleaning proposals (optional)** — on the Quality tab, the engine first scans the file
  for values that look dirty (numbers written with a unit or bound such as `42 Lac` or
  `125+`, one category spelled several ways, placeholders such as `-999`); a language model
  then proposes rules in a closed format. Each rule is applied to a copy and measured before
  it can be accepted, accepted rules re-run the analysis on the original rows, the report
  says it was built from cleaned data, and the rules export as a pandas snippet.
- **Methodology page** — `/methodology` documents every stage of the engine: the rule
  behind each decision, the thresholds and estimators it uses, and what it cannot decide

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
| `npm test` | Engine and Worker regression suites (plain Node) |

Ad-hoc dataset reports (no npm script — it takes file arguments):

```bash
node tools/report.mjs data/*.csv [--target=Col] [--out=reports]
```

Parses each CSV exactly as the app does, runs the analysis engine over it, and
writes the full `analyzeDataset()` output to `reports/<name>.json` — one file per
dataset, so a result can be diffed or re-read later. Written for testing the
engine against many datasets; it is not part of the shipped app.

## Deployment

Deployed on **Cloudflare Workers** with static assets, connected to the GitHub repository
through Workers Builds. Every push triggers a build and a deploy — there is nothing to
upload by hand and no build output in the repository.

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` (the default) |
| Static assets | `dist` |
| Worker config | `wrangler.jsonc` (entry script `worker/index.js`) |
| Secret | `OPENROUTER_API_KEY` |

The app is a static single-page application; Cloudflare serves `index.html` for client-side
routes such as `/methodology` and `/analyze`. Only `/api/*` requests run the Worker script —
everything else is served straight from `dist`. Server-side code lives in `worker/index.js`,
not in a `functions/` directory, which is a Cloudflare Pages feature and does not run on
Workers.

### AI endpoint

`POST /api/ai` with `{ "task": "<name>", "payload": { ... } }` forwards a server-defined
prompt to [OpenRouter](https://openrouter.ai) and returns `{ task, model, result }`. The
client only names a task; prompts, JSON schemas and token limits live in the Worker. Tasks:
`ping` (deployment check), `review` (dossier and cleaning rules in one request, on the
target picker), `leakage` (Target Signal tab), and the two tasks `review` replaces while it
is evaluated: `dossier` and `cleaning` (the Quality tab's "ask again"). The
analysis itself still runs entirely in the browser.

- **Models** — `AI_MODELS` in `wrangler.jsonc`, comma-separated, tried in order by
  OpenRouter's fallback. An empty value switches the endpoint off.
- **Key in production** — Cloudflare dashboard → the `vecto` Worker → Settings → Variables
  and Secrets → Add, type **Secret**, name `OPENROUTER_API_KEY`. Or
  `npx wrangler secret put OPENROUTER_API_KEY`. Never a build variable, never `VITE_*`.
- **Key locally** — a `.dev.vars` file in the repository root (gitignored) containing
  `OPENROUTER_API_KEY=...`. Run `npx wrangler dev` (needs one `npm run build` so `dist/`
  exists) beside `npm run dev`; the Vite dev server proxies `/api` to wrangler on port 8787.

| Response | Meaning |
| --- | --- |
| `503 ai_disabled` | no key or no models configured |
| `400 unknown_task` / `invalid_body`, `413 payload_too_large` | rejected before any model call |
| `429 rate_limited` | every model in the list is rate-limited, or the daily quota is spent |
| `502 upstream_error` / `empty_response` / `invalid_json` | OpenRouter failed, or the model's reply was not valid JSON after one repair attempt |

### AI eval

`tools/ai-eval.mjs` runs an AI task through the real `/api/ai` endpoint over the local test
corpus and scores each answer against known answers written before the first run:
`--task=dossier` (default) against `tools/ai-eval/expectations.mjs` (targets, roles,
subtypes), `--task=leakage` against `tools/ai-eval/leakage-expectations.mjs` (known leaks,
legitimate predictors that must not be flagged, split strategy), and `--task=cleaning`
against `tools/ai-eval/cleaning-expectations.mjs` (rules and factors, rules that must be declined),
and `--task=review` against both, with the dossier and cleaning scores reported apart.
Answers are verified exactly as the page verifies them, cached by payload hash in
`reports/ai-eval/`, and summarised in `reports/ai-eval/summary.md`, including the engine's
own target guess for comparison.

```bash
npx wrangler dev                                   # terminal 1, reads .dev.vars
node --max-old-space-size=8192 tools/ai-eval.mjs   # [--task=leakage] [--only=titanic] [--fresh] [--rescore]
```

One request per file, or one per 25 columns for a wider file (the same parts the page sends);
a rate-limit response stops the run and finished files stay cached. The cache is keyed on the
payload and on `worker/dossierPrompt.js`, so a prompt change re-asks every file. `--rescore`
makes no requests.

## Tests

The analysis engine has a dependency-free regression suite that runs on plain Node:

```bash
npm test
```

This runs nine files:

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
- **`tests/hardening.test.mjs`** — proves the engine survives real input: very large
  columns, malformed CSVs, an identifier picked as the target, and cancelling a running
  analysis. Known defects can be pinned before they are fixed, and a pinned defect that
  starts passing fails the suite so it cannot become untested.

- **`tests/ai-worker.test.mjs`** — the `/api/ai` Worker handler with OpenRouter replaced by a
  scripted `fetch`: request validation, that client-sent prompts are ignored, the
  rate-limit response, and the single repair round for invalid JSON. No key or network.
- **`tests/ai-dossier.test.mjs`** — what the column dossier sends (no rows, no free-text
  values, bounded examples, deterministic), how a wide file is split into parts and merged,
  and how a model's answer is verified against the data before it is shown.
- **`tests/ai-leakage.test.mjs`** — what the leakage review sends (no cell values) and how
  each claim becomes a measurement: formula evaluation including fixed offsets, group
  measurement, the engine's own association, and timing claims as questions.
- **`tests/ai-cleaning.test.mjs`** — cleaning candidates, rule application (never in place),
  rule verification and measurement, and the pandas export.
- **`tests/ai-eval-score.test.mjs`** — the eval's scoring rules on hand-built answers.

Run `npm test` after any change under `src/components/utils/core/`.

## Project structure

```text
src/
  App.jsx                     routes: / (upload), /analyze (target → processing → results),
                              /methodology (how the engine works)
  lib/
    datasetHandoff.js         Home -> Analyze handoff (module singleton, not router state)
    ai/                       AI client (requestAi); per feature a payload builder, a verifier
                              and a schema shared with the Worker (dossier, leakage,
                              cleaning)
  content/
    methodology.js            copy for /methodology — thresholds quoted from the engine
  pages/
    Home.jsx                  intro + the functional CSV dropzone
    Analyze.jsx                3-step machine: Target → Processing → Results
    Methodology.jsx           the eight engine stages, trust principles and limits
  components/
    layout/Header.jsx         fixed, full-width, shared by every page
    common/                   shared primitives (ErrorBoundary, SectionLabel)
    analyze/
      shared/                 primitives used across steps/tabs (RolePill, StatTile,
                               SectionCard, StatusBadge, correlationColor)
      TargetStep/              target-column picker
      ResultsDashboard/        tabbed report (Overview/Quality/Statistics/
                                Visualizations/Target Signal/Relationships/
                                Class Balance)
    utils/core/                the analysis engine (pure functions, no side effects)
      roles.constants.js      ROLE enum — the single source of truth for role strings
      index.js                analyzeDataset() orchestrator
      detectors/              column-role classification, target guessing
      analyzers/              quality, statistics, relationships
      scoring/                health score
      intelligence/           insights and recommendations
      helpers.js              shared numeric utilities
tests/                        engine regression suite, output-shape contract, Worker tests
worker/index.js               Cloudflare Worker entry: POST /api/ai (OpenRouter proxy)
worker/dossierPrompt.js       the column-dossier prompt
worker/leakagePrompt.js       the leakage-review prompt
worker/cleaningPrompt.js      the cleaning-proposal prompt
tools/ai-eval.mjs, ai-eval/   dossier eval over the test corpus, known answers, scoring
wrangler.jsonc                Worker + static-assets config, AI model list
```

## Tech stack

React 19 · Vite 8 · React Router 7 · Tailwind CSS 4 (CSS-first config, no
`tailwind.config.js`) · Framer Motion · PapaParse · lucide-react

Routes are code-split with `React.lazy`, and the results dashboard loads as its own
chunk only once an analysis finishes.

## Privacy

Vecto has no backend. CSV parsing and every statistic are computed client-side in
JavaScript; nothing is transmitted, stored, or logged anywhere.

## License

Private project. All rights reserved.

