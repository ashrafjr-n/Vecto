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
  unit, a plausible range, **whether the column records a personal attribute** (one value
  from a closed list — sex or gender, race or ethnicity, health, age, nationality, and so
  on — or nothing at all) and the likely target, together with cleaning rules for the values
  the engine's scan found dirty (see cleaning proposals below). Every claim is checked against the file before it is shown: quoted values
  must exist, a suggested role the data contradicts is not offered, the plausible range is
  counted by the engine, and an unusable target is withheld. An accepted role becomes an
  explicit input to the analysis and is marked in the report; accepted cleaning rules are
  applied to the upload before the first analysis, so no re-run is needed.
- **Proxies for personal data** — when the review flags a column as recording a personal
  attribute, the Relationships tab lists the columns the engine **measured** against it,
  because dropping a column does not remove the attribute if another column predicts it.
  On Titanic, `who` is read as age and `adult_male` reproduces it at Cramér's V = 1.00.
  The card also says how many columns were never compared with it at all — between
  features the engine measures numeric against numeric and categorical against
  categorical, never one against the other — so silence is not read as an all-clear. It
  appears only when something was flagged: there is no "no personal data found" message,
  because that would be a claim nobody measured.
- **AI leakage review (optional)** — on the Target Signal tab, a language model reads column
  names, roles and the engine's measured associations (no cell values) and names the
  columns a model could not use at prediction time: derived from the target, recorded after
  the outcome, the label under another name, or an entity repeated across rows — plus the
  split an honest evaluation needs. Every proposed formula is evaluated on the rows, and a
  total that differs only by a few fixed amounts (an unrecorded surcharge) is recognised as
  such; group claims are measured; timing claims are shown as questions. Advisory only.
  It also carries two **relevance** categories, which are the opposite question and are not
  accusations: a column worth keeping despite a weak measured association, and a strong
  association with no reason behind it. Both always render as open questions with the
  engine's own number quoted — including where that number disagrees with the claim.
- **AI cleaning proposals (optional)** — the engine scans the file for values that look
  dirty (numbers written with a unit or bound such as `42 Lac` or `125+`, one category
  spelled several ways, placeholders such as `-999`) and a language model proposes rules in
  a closed format, as the second half of the column review above. The Quality tab shows the
  same proposal and can run that scan and ask for itself, for a report reached without a
  review. Each rule is applied to a copy and measured before it can be accepted, accepted
  rules run the analysis on the original rows, the report says it was built from cleaned
  data, and the rules export as a pandas snippet.
- **Rare flags get a second number** — a binary feature present on a small share of rows
  cannot show a large correlation however well it predicts, so where one appears the report
  adds an odds ratio with its 95% interval and says in words whether the interval crosses 1.
- **Answers are reused, not re-bought** — an AI answer is stored in the viewer's own
  browser, keyed on the task and the exact bytes that were sent, so asking the same
  question about the same file again costs no request. Nothing is stored on a server, the
  panels say so, and a button clears the lot.
- **Methodology page** — `/methodology` documents every stage of the engine: the rule
  behind each decision, the thresholds and estimators it uses, what it cannot decide, and
  how well the optional AI assistant scores on files its prompts were never tuned on

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
`ping` (deployment check), `review` (the column dossier and cleaning rules in one request,
from the target picker or the Quality tab) and `leakage` (Target Signal tab). The analysis
itself still runs entirely in the browser.

- **Models** — `AI_MODELS` in `wrangler.jsonc`, comma-separated, tried in order by
  OpenRouter's fallback. An empty value switches the endpoint off. It currently holds a
  single model, chosen on measured accuracy: the alternatives either returned no findings
  on datasets with documented leakage or were never available on the free tier.
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
`--task=review` (default) against both `tools/ai-eval/expectations.mjs` (targets, roles,
subtypes) and `tools/ai-eval/cleaning-expectations.mjs` (rules and factors, rules that must
be declined), with the two scores reported apart as "B checks" and "D checks"; and
`--task=leakage` against `tools/ai-eval/leakage-expectations.mjs` (known leaks, legitimate
predictors that must not be flagged, split strategy).
Answers are verified exactly as the page verifies them, cached by payload hash in
`reports/ai-eval-review/`, and summarised in that directory's `summary.md`, including the
engine's own target guess for comparison.

`--set=validation` and `--set=test` score held-out files from new domains instead, against
`tools/ai-eval/validation-expectations.mjs` and `test-expectations.mjs` (written from each
file's published dictionary before any request), into `reports/ai-eval-<task>-<set>/`. They
are never used to tune a prompt, and the test set is run once.

```bash
npx wrangler dev                                   # terminal 1, reads .dev.vars
node --max-old-space-size=8192 tools/ai-eval.mjs   # [--task=leakage] [--set=validation] [--only=titanic] [--fresh] [--rescore]
```

One request per file, or one per 25 columns for a wider file (the same parts the page sends);
a rate-limit response stops the run and finished files stay cached. The cache is keyed on the
payload and on the task's prompt and schema files, so a prompt change re-asks every file.
`--rescore` makes no requests.

The eval's known answers were written by the same author as the prompts, so a second check
tests the eval itself: `tools/blind-sample.mjs` writes a labelling sheet
(`forTesting/blind/sheet.html`) for a seeded, stratified sample of columns, with no engine
role, model answer or expectation shown. A person fills it in and saves `labels.json`, and
`tools/blind-agreement.mjs` reports Cohen's κ against the model and against the expectations,
with every disagreement listed. Neither script makes a request.

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
    ai/                       AI client (requestAi) and its browser answer cache; per
                              feature a payload builder, a verifier
                              and a schema shared with the Worker (dossier, leakage,
                              cleaning)
  content/
    methodology.js            copy for /methodology — thresholds quoted from the engine,
                              AI figures quoted from held-out eval runs
  pages/
    Home.jsx                  intro + the functional CSV dropzone
    Analyze.jsx                3-step machine: Target → Processing → Results
    Methodology.jsx           engine stages, trust principles, measured AI accuracy, limits
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
worker/reviewPrompt.js        the column-review prompt (dossier + cleaning in one request)
tools/ai-eval.mjs, ai-eval/   AI evals over the test corpus, known answers, scoring
tools/blind-*.mjs             blind labelling sheet and agreement (checks the eval itself)
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

<!-- vn -->
