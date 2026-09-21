/* Content for /methodology — what the engine actually does, written for the
   people who will check it. Every threshold quoted here is a literal in
   src/components/utils/core/. If a rule there changes, this copy is wrong until
   it is changed too; nothing links the two automatically. */

export const METHODOLOGY_INTRO = {
  headline: "How Vecto reads a dataset.",
  lead: [
    "Every figure in a Vecto report comes from a deterministic JavaScript engine that runs in your browser tab. No model computes any of it and no server is behind it — the same file and the same target produce the same report, every time. An optional AI assistant can suggest what columns mean, which columns leak the target and how dirty values should be cleaned; everything it says is labelled, checked against the file, and changes the report only when you accept it.",
    "This page documents that engine: the order it works in, the rule behind each decision, the thresholds it uses, and — just as important — what it cannot decide and hands back to you.",
  ],
};

/* The eight stages, in the order a report is assembled. */
export const PHASES = [
  {
    id: "target",
    title: "Target selection",
    lead: "The target column decides which measurements are possible, so it is fixed before anything else runs. You can pick it, run without one, or let the engine guess.",
    points: [
      { label: "Usable only", text: "Every rule picks from usable columns only: a numeric, binary or categorical role, at least two distinct values, and at least half the rows filled in. An identifier, a date, free text or a single-valued column is never suggested." },
      { label: "Name match", text: "An exact, case-insensitive match against common label names: target, label, class, outcome, churn, purchased, survived, default, fraud, status, result, y, output, price. Then a word inside a longer name — only target, label, outcome, churn, fraud, survived, purchased or price, because \"marital_status\" and \"passenger_class\" are features." },
      { label: "Last column", text: "Otherwise the last column, when it is binary or a categorical with at most 20 levels — targets tend to sit at the end of a file." },
      { label: "Binary values", text: "Otherwise the last column whose two levels are 0/1, yes/no or true/false." },
      { label: "Low cardinality", text: "Otherwise, scanning from the last column backwards, the first with no more than 5% distinct values relative to the row count." },
      { label: "Fallback", text: "Otherwise the last usable measurement or short class list, and failing that the coarsest usable column. The guess is a starting point shown in the picker, never a silent decision." },
    ],
  },
  {
    id: "roles",
    title: "Column roles",
    lead: "Every column is assigned one of six roles — identifier, temporal, binary, numeric, categorical or free text — and the role alone decides how the column is treated downstream. Roles are inferred from the values, over the whole column, never from a head sample.",
    points: [
      { label: "Identifiers first", text: "A column is an identifier when its name contains id, uuid, key, index or ref and more than 90% of values are distinct; when its first 200 values form a gapless integer sequence starting at 0 or 1; or when those values carry leading zeros. Wider hints (zip, phone, account, ticket, serial…) count only alongside a shape signal — a constant width of five or more digits, or more than 99% uniqueness — so account_balance is never called an ID." },
      { label: "Dates", text: "At least 90% of the first 100 non-missing values must parse as one date family: ISO dates and datetimes, year-first or day/month-first numeric dates, or month names. Parsing is strict regex plus range checks, never Date.parse. Bare years and epoch timestamps have no date structure and stay numeric; a day/month column whose values contradict each other is rejected." },
      { label: "Binary", text: "Exactly two distinct levels, however written — 0/1, yes/no, M/F." },
      { label: "Keys that repeat", text: "A column whose name contains the word id, uuid, key, ref or index — split on camelCase and punctuation, so MeetID counts — but whose values repeat is a key into another table or an entity: above 50 distinct values it is an identifier (openpowerlifting's MeetID, 8,482 meets), at or below it a categorical group such as a store_id, and never numeric, because an id's arithmetic means nothing. 50 is a stated default, not a measured threshold." },
      { label: "Numeric", text: "At least 80% of non-missing values are numbers. An all-integer column with four or fewer distinct values is read as an encoded category instead." },
      { label: "Free text", text: "Average length of at least 40 characters, a space in at least half the values, and more than 50 distinct values. All three must hold: length alone would call a URL free text, spacing alone would call a person's name free text." },
      { label: "String identifiers", text: "A non-numeric column that is more than 95% distinct across the whole column. This rule runs after the free-text rule, and declines to fire when the distinct count exceeds 20,000 rather than estimating a ratio it cannot measure." },
      { label: "Everything else", text: "Categorical. Values are normalised to one grouping key — trimmed, case-folded, numbers by parsed value — so MALE, male and Male with stray spaces are one level, displayed with an original spelling." },
    ],
  },
  {
    id: "quality",
    title: "Data quality",
    lead: "Quality is measured before any statistic is computed, because every later number inherits its gaps. Problems are reported per column, with counts and examples, and folded into one weighted quality score.",
    points: [
      { label: "Missing values", text: "Empty cells and the tokens NA, N/A, NaN, null, none and ? — trimmed and case-insensitive — are missing, and are excluded from every downstream calculation, not merely counted." },
      { label: "Mixed numeric columns", text: "A column that is more than 80% numbers is still analysed as numeric, but the values dropped to allow that are reported with their count and up to three real examples. \"125+\" is not silently read as 125." },
      { label: "Possible codes", text: "A gapless run of 5 to 25 integers starting at 0 or 1 is flagged: from the values alone a count and an encoded category are indistinguishable, and if they are codes, the mean and histogram describe nothing. The engine names the ambiguity instead of guessing." },
      { label: "Constant and near-unique columns", text: "A column with one distinct value is constant. A column more than 95% distinct that is not already an identifier, date or free text is flagged as likely an ID." },
      { label: "Duplicate rows", text: "Counted on datasets of up to 50,000 rows. Above that the scan is skipped and reported as not measured — never shown as zero." },
      { label: "Quality score", text: "A weighted sum: missing values 45%, duplicates 25%, constant columns 15%, identifier columns 15%. When duplicates were not measured their weight is redistributed (60 / 20 / 20) rather than scored as clean. The missing-value component charges overall emptiness, the single worst column, and every column more than 20% empty." },
    ],
  },
  {
    id: "statistics",
    title: "Column statistics",
    lead: "Each numeric column is parsed once and sorted once; every order statistic reads from that single sorted array. The definitions are the ones pandas and scipy use, so a figure here can be checked against a notebook.",
    points: [
      { label: "Location and spread", text: "Mean, median, sample standard deviation (ddof = 1), minimum and maximum. Quartiles use linear interpolation — numpy's default, type 7." },
      { label: "Shape", text: "Skewness is the bias-corrected moment estimator (scipy.stats.skew, bias=False); kurtosis is bias-corrected excess kurtosis (Fisher, normal = 0). |skew| under 0.5 is labelled symmetric, up to 1 moderate, above 1 high." },
      { label: "Outliers", text: "Skew-adjusted boxplot fences (Hubert & Vandervieren 2008): the medcouple, a robust skewness, stretches the fence on the long side and tightens it on the short side, and at zero skew it is exactly Tukey's 1.5 × IQR. Plain Tukey fences call a long right tail itself \"outliers\" — 13% of Titanic fares. Above 1,500 values the medcouple is estimated from 1,500 evenly spaced order statistics; the count is always over every value. On a right-skewed column the tightened lower fence can flag small legitimate values (the youngest passengers), which is why the advice is to review, not remove. Skipped for columns with ten or fewer distinct values. Recommendations cap at the same fences." },
      { label: "Distributions", text: "Numeric columns get a ten-bin equal-width histogram; categorical columns get level frequencies grouped by the normalised key. The distribution view reads the same statistics rows, so the chart and the table cannot disagree." },
      { label: "One parsing rule", text: "A value is a number only if the whole string is numeric. Bare parseFloat would read \"12kg\" as 12 and \"1,234\" as 1; those values are instead missing for the column and reported under data quality." },
    ],
  },
  {
    id: "relationships",
    title: "Feature relationships",
    lead: "Feature-to-feature association answers one question: which columns say the same thing twice. Numeric and categorical pairs are measured with different statistics and reported separately, because their magnitudes are not comparable.",
    points: [
      { label: "Pearson and Spearman", text: "Every numeric pair gets Pearson's r and Spearman's ρ with a two-sided p-value. Ranks are computed once per column, not once per pair. A pair is reported when the larger of |r| and |ρ| exceeds 0.4, and marked monotonic-but-not-linear when |ρ| exceeds |r| by more than 0.15." },
      { label: "Redundancy", text: "A pair at |r| ≥ 0.9 is flagged as redundant. This is pairwise correlation, not a variance inflation factor — see Limits below." },
      { label: "Clusters", text: "A column correlated at |r| ≥ 0.7 with two or more others joins a cluster; three or more clustered columns prompt dimensionality reduction for the group, since removing one flagged pair at a time misses that they measure the same thing." },
      { label: "Cramér's V", text: "Categorical pairs use Cramér's V with the Bergsma (2013) bias correction, and chi-square summed over the whole contingency table — empty cells included. Uncorrected, V climbs toward 1 on cardinality alone; with both corrections, a per-row-unique column scores 0 and a true one-to-one mapping scores 1. Pairs at V ≥ 0.3 are reported." },
      { label: "Scan limits", text: "Up to 40 numeric columns enter the matrix; above that the 40 with the most distinct values are kept and the rest are listed as excluded. Up to 25 categorical columns are paired. Identifier, date and free-text columns are left out, each with the reason stated." },
    ],
  },
  {
    id: "target-signal",
    title: "Target signal and leakage",
    lead: "Each feature is measured against the target with the statistic its pair of types allows, and every coefficient is published with its p-value and the number of rows behind it. Results are grouped per metric and never merged into one ranking: Pearson, Cramér's V and η share a 0–1 scale without meaning the same thing.",
    points: [
      { label: "Metric by type", text: "Types are the column roles assigned earlier — the scan never re-guesses them. Numeric or binary feature against a numeric or binary target: Pearson (point-biserial when one side is 0/1) with Spearman beside it. Numeric against categorical, in either direction: a rank-based η — the Kruskal–Wallis H with its bias-corrected effect size η²_H = (H − k + 1)/(n − k), reported as its square root, with the H test's p-value. Ranks stop one extreme value from deciding it (a single 6.7M price hid location's association, 0.11 against a rank-based 0.65), and the correction stops a feature with many levels from climbing on cardinality. Categorical against a categorical or binary target: bias-corrected Cramér's V. A date or free-text target is not scored. Binary levels are sorted before 0/1 encoding, so the sign of r never depends on row order." },
      { label: "Non-monotonic signal", text: "When both |r| and |ρ| are under 0.3, normalised mutual information is estimated with the Miller–Madow correction, on eight quantile bins and a deterministic 20,000-row sample. A feature the correlations call noise but that scores MI ≥ 0.15 is reported as a real, non-monotonic relationship." },
      { label: "Nothing leaves silently", text: "A column that cannot be scored is listed with its reason. A constant feature, or a target that never varies across the feature's rows, is unmeasurable — not a correlation of zero, which would claim a relationship was tested and absent." },
      { label: "Presence as signal", text: "For columns with missing values, whether the value was recorded at all is tested against the target. With at least 20 rows on each side and Cramér's V ≥ 0.3, the report proposes a presence indicator and quotes the measured V." },
      { label: "Leakage", text: "A feature is a leakage suspect at |r| ≥ 0.95 or Cramér's V ≥ 0.95 against the target — after the corrections above, both mean near-determinism. A presence indicator at V ≥ 0.95 is flagged the same way. η is deliberately excluded: η near 1 also occurs for genuinely strong categorical predictors." },
      { label: "Coverage", text: "A coefficient measured on under half the rows is badged as such, and the strongest broadly-measured feature is named beside it, so a perfect score on 0.3% of the data is not read as the headline." },
    ],
  },
  {
    id: "class-balance",
    title: "Class balance",
    lead: "The problem type follows the target's role: a numeric target is regression, a binary or categorical one is classification, a date is forecasting. For a classification target the distribution of classes is measured directly; a regression target has no classes, so no class table or imbalance advice is produced for it.",
    points: [
      { label: "Classes", text: "Levels are grouped by the same normalised key as everywhere else, and percentages are taken over all rows, with missing target values shown as their own row so the shares add up." },
      { label: "Imbalance", text: "A target is imbalanced when the majority class is more than three times the minority, or holds more than 80% of rows. The ratio catches multi-class skew — 60 / 20 / 20 — that a majority threshold alone would pass." },
      { label: "Absolute counts", text: "The smallest class is named with its row count. Under ten rows is called critically few regardless of what the percentage looks like." },
      { label: "Identifier as target", text: "A target that is unique per row is an identifier, not a label, and holds the health score to 40. Cardinality cannot detect this — a continuous price is also one value per row — so the identifier rules from the role stage decide it — plus, for a text target only, the role stage's rule that more than 95% distinct values is an identifier." },
      { label: "Unusable target", text: "A target with a single value holds the score to 25 and is not scanned against any feature. A target's missing rows are advised to be dropped, never imputed — an imputed label is an answer the engine invented." },
    ],
  },
  {
    id: "scoring",
    title: "Health score and recommendations",
    lead: "The health score is a summary, not a verdict: four weighted dimensions, then caps that can only lower it, each carrying the reason it applied. Recommendations turn findings into actions and state why each one was made.",
    points: [
      { label: "Dimensions", text: "Quality (the score from the quality stage), structure (row count, column count, a mix of numeric and categorical features), relationships (redundant pairs, strength of the strongest target association) and target readiness (no leakage suspects, target completeness, class balance). Weighted 30 / 20 / 20 / 30 with a target, 40 / 30 / 30 without one." },
      { label: "Evidence caps", text: "Under 10 rows holds the score to 25, under 50 to 50, under 200 to 75. A worst column that is 50% or more empty imposes a ceiling that slides with severity — 89 at 50%, 60 at 90%, 45 at 100% — so datasets with unlike problems do not collapse onto one number." },
      { label: "Grades", text: "90 and above Excellent, 75 Good, 60 Fair, 40 Poor, below that Critical." },
      { label: "Role-aware advice", text: "Each recommendation is tied to what the column is: a date is never offered mean imputation, a near-unique column is not told to group rare levels into \"Other\", a count is not given the transform meant for a long continuous tail, and a mostly-empty column is weighed as a presence indicator before it is dropped." },
      { label: "One decision per column", text: "A column that is dropped (identifier, constant, empty), replaced by a presence indicator, or under leakage investigation gets no further advice — no outlier, skew or imputation step for a column already on its way out, and no pair advice that assumes it stays. Leakage outranks everything else about a column. The summary cards at the top of the report follow the same decisions, and a message that applies to several columns is one card naming them." },
      { label: "Direction", text: "Cramér's V is symmetric but dependency is not. When one column has at least three times the levels of the other, a high V means the finer column determines the coarser one, and the advice says so instead of \"keep one of the two\". Columns of similar grain keep that advice only at V ≥ 0.9, the bar the numeric redundancy check uses: below it, two columns that mostly agree still each carry something the other does not." },
      { label: "Grouping", text: "Advice that is identical across columns — a few missing cells, no detectable relationship with the target — is one item naming every column, not one item each." },
      { label: "Categories and priority", text: "Actions are tagged Data Cleaning, Feature Selection, Feature Engineering, Modeling or Data Integrity, prioritised high, medium or low, and every one carries its rationale." },
    ],
  },
  {
    title: "Preparation plan and baseline model",
    lead: "The recommendations become a training pipeline, and one untuned model measures what that pipeline can support. Neither lives in the engine: both read its finished report, so they cannot make a decision the report did not.",
    points: [
      { label: "Split first", text: "80 / 20, stratified for a class target, or grouped by a column the advice calls too fine to learn from (under 5 rows per level), so one entity never sits on both sides. Rows with a missing target and duplicate rows are removed before the split." },
      { label: "Fitted on train only", text: "Every median, mean, standard deviation and category list is learned from the training rows alone. Imputation follows the advice — median when |skewness| > 1, mean otherwise, most frequent level for categories — with a missing-value indicator past 20% missing, and a presence indicator alone past 50%. Categories keep their 19 most frequent levels plus one bucket for the rest." },
      { label: "Left out, with a reason", text: "Identifiers, empty or constant columns, leakage suspects, dates and free text are excluded, and each exclusion is written into the plan and into the exported script." },
      { label: "The script", text: "The plan exports as a scikit-learn script (pandas, ColumnTransformer, SimpleImputer, StandardScaler, OneHotEncoder, MissingIndicator) that splits, fits on the training rows and transforms both sides. It stops at prepared features: no model and no tuning." },
      { label: "Baseline model", text: "Ridge regression with alpha 1 (one-vs-rest for a class target), cross-validated over 5 folds with the preparation refitted inside each fold, on an evenly spread sample of at most 5,000 rows. Scored in balanced accuracy or R², against a model that predicts the majority class or the training mean. The solver matches scikit-learn's Ridge and RidgeClassifier to 1e-11." },
      { label: "Is there signal", text: "A paired t-test across the folds with the Nadeau–Bengio correction for folds that share training rows; signal needs t ≥ 2.78 (p < 0.05). No signal means the easy, linear signal is absent — not that none exists." },
      { label: "One column too good", text: "Each column alone, numbers binned into 20 training quantiles so a curved relationship counts. A column scoring 0.95 or more — the engine's leakage bar — is flagged to check. A near-perfect score from all columns together is raised as a question, because a genuinely separable target looks the same." },
    ],
  },
];

/* Why the numbers can be trusted — each one a property that can be checked, not
   an adjective. Absorbs Home's former "Trustworthy by construction" list. */
export const PRINCIPLES = [
  {
    title: "Validated against scipy",
    text: "The statistical core is tested against a reference generated with pandas and scipy — sample variance and standard deviation, type-7 quartiles, bias-corrected skewness and kurtosis, Pearson's r and its p-value, Spearman's ρ — to a tolerance of 1e\u20116 (p-values to 1e\u201112). The comparison is an automated test in the repository, not a one-off check.",
  },
  {
    title: "Roles come from the data",
    text: "Column roles are inferred from values over the whole column, not from names and not from the first rows. A name can support a signal; it never decides a role on its own.",
  },
  {
    title: "Estimators are bias-corrected",
    text: "Plug-in association measures grow with the number of cells, which is how a name column once outranked sex as Titanic's top predictor. Cramér's V carries the Bergsma correction and mutual information the Miller–Madow correction, and no new estimator ships without one.",
  },
  {
    title: "Not measured is never shown as clean",
    text: "A skipped duplicate scan is reported as skipped and its weight redistributed. A column the target scan could not score is listed with its reason. A value dropped to keep a column numeric is counted and quoted.",
  },
  {
    title: "Every number arrives with its reason",
    text: "Coefficients come with a p-value and n, recommendations with a rationale, and a capped score with the evidence that held it. A number without its reasoning can only be believed or ignored.",
  },
  {
    title: "Deterministic and local",
    text: "Parsing and analysis run in this browser tab, in a background worker. No file is uploaded — the optional AI assistant sends only summaries of the file, never its rows, and never before you have asked for it once; after that, the leakage review of a new report runs by itself. Sampling is deterministic, so the same file and target always produce the same report.",
  },
];

/* How well the optional AI assistant actually does, measured. Every figure here is
   from vecto-plan items 19 (validation and test sets, expectations committed before
   any request) and 17 (the owner's blind labels) — NOT from the corpus the prompts
   were tuned on, which scores higher and would flatter the assistant. Update these
   only from a recorded run; a rounder number here is a worse number. */
export const AI_MEASURED = [
  {
    title: "Choosing the target",
    text: "On 10 files never used to write the prompt — new domains, each with a published data dictionary, run once — the assistant's first suggestion matched the documented target 10 times out of 10. The engine's own name-and-shape guess matched 5 of 10 on the same files. On a separate 8-file set used while the prompt was still moving: 7 of 7 against the engine's 2 of 7.",
  },
  {
    title: "Describing columns",
    text: "On that same 10-file run, 213 of 214 checks passed: roles 118 of 118, subtypes 75 of 76. The one miss called a census sampling weight a count. Cleaning rules were the weaker half at 9 of 11, both misses on one file that writes decimals with commas — the cause was a bug in the engine's own scan, since fixed.",
  },
  {
    title: "A person labelled the same columns blind",
    text: "60 columns from 17 files, shown only what the model is shown — the name and a profile, no dictionary, no engine role. The labeller answered \u201cnot sure\u201d for 55% of them. Where they did decide (n = 36), their role agreed with the model at \u03ba 0.86 and with the written expectations at \u03ba 0.93. Half of these columns are undecidable from what the model sees, so the scores above rest on files that arrived with documentation.",
  },
  {
    title: "Leakage is the weaker task",
    text: "92% of checks on the files the prompt was written against, but only 11 of 14 known leaks were raised. On the 10-file held-out run it scored 88% and raised 4 of 12, under an earlier model setting. It also raises columns that turn out to be legitimate \u2014 which is why a claim the engine cannot measure is shown as a question, never as a verdict.",
  },
];

/* What the engine does not decide. Stated for the reader who will otherwise find
   each one the hard way. */
export const LIMITS = [
  { title: "Meaning", text: "The engine sees values, not semantics. It cannot know that a column is a post-outcome field, or that an outlier is a data-entry error rather than a real event." },
  { title: "Codes versus counts", text: "Integer columns with 5 to 25 levels stay numeric and are flagged; only you know whether they are codes." },
  { title: "Dates", text: "Detected from the first 100 non-missing values. Epoch timestamps, compact YYYYMMDD, week, quarter and time-only formats are not recognised." },
  { title: "Scale", text: "Files up to 40MB. Duplicate rows are counted up to 50,000 rows, the correlation matrix holds 40 numeric columns and categorical pairing 25 columns, and mutual information is estimated on a 20,000-row sample." },
  { title: "Spearman in the matrix", text: "Ranks are computed once per column, so where columns have different missing rows, ρ can differ slightly from a pairwise scipy.stats.spearmanr. Spearman against the target is computed exactly on each pair." },
  { title: "Headerless files", text: "A first row where at least half the cells are decimal or negative numbers is offered as data rather than names. A headerless file of whole numbers is not caught: that row cannot be told apart from a header of years or indices." },
  { title: "Baseline model", text: "Linear and untuned, so it is a floor. A column that restates the target only in part — a total that includes it — scores well below the 0.95 bar on its own; the leakage review's formula check is what catches that shape." },
  { title: "Multicollinearity", text: "Redundancy is pairwise correlation. A column that is a linear combination of three others will not be caught by it." },
];
