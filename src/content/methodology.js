/* Content for /methodology — what the engine actually does, written for the
   people who will check it. Every threshold quoted here is a literal in
   src/components/utils/core/. If a rule there changes, this copy is wrong until
   it is changed too; nothing links the two automatically. */

export const METHODOLOGY_INTRO = {
  headline: "How Vecto reads a dataset.",
  lead: [
    "Every figure in a Vecto report comes from a deterministic JavaScript engine that runs in your browser tab. There is no model in the loop and no server behind it — the same file and the same target produce the same report, every time.",
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
      { label: "Name match", text: "An exact, case-insensitive match against common label names: target, label, class, outcome, churn, purchased, survived, default, fraud, status, result, y, output." },
      { label: "Binary values", text: "Otherwise, a column whose two levels are 0/1, yes/no or true/false. When several qualify the last one wins — targets tend to sit at the end of a file." },
      { label: "Low cardinality", text: "Otherwise, scanning from the last column backwards, the first column with at least two distinct values and no more than 5% distinct relative to the row count." },
      { label: "Fallback", text: "Otherwise the last column. The guess is a starting point shown in the picker, never a silent decision." },
    ],
  },
  {
    id: "roles",
    title: "Column roles",
    lead: "Every column is assigned one of six roles — identifier, temporal, binary, numeric, categorical or free text — and the role alone decides how the column is treated downstream. Roles are inferred from the values, over the whole column, never from a head sample.",
    points: [
      { label: "Identifiers first", text: "A column is an identifier when its name contains id, uuid, key, index or ref and more than 90% of values are distinct; when it is a gapless integer sequence starting at 0 or 1; or when its values carry leading zeros. Wider hints (zip, phone, account, ticket, serial…) count only alongside a shape signal — a constant width of five or more digits, or more than 99% uniqueness — so account_balance is never called an ID." },
      { label: "Dates", text: "At least 90% of the first 100 non-missing values must parse as one date family: ISO dates and datetimes, year-first or day/month-first numeric dates, or month names. Parsing is strict regex plus range checks, never Date.parse. Bare years and epoch timestamps have no date structure and stay numeric; a day/month column whose values contradict each other is rejected." },
      { label: "Binary", text: "Exactly two distinct levels, however written — 0/1, yes/no, M/F." },
      { label: "Numeric", text: "At least 80% of non-missing values are numbers. An all-integer column with four or fewer distinct values is read as an encoded category instead." },
      { label: "Free text", text: "Average length of at least 40 characters, a space in at least half the values, and more than 50 distinct values. All three must hold: length alone would call a URL free text, spacing alone would call a person's name free text." },
      { label: "String identifiers", text: "A non-numeric column that is more than 95% distinct across the whole column. This rule runs after the free-text rule, and declines to fire when the distinct count exceeds 20,000 rather than estimating a ratio it cannot measure." },
      { label: "Everything else", text: "Categorical. Values are normalised to one grouping key — trimmed, case-folded, numbers by parsed value — so \" Male \", \"MALE\" and \"male\" are one level, displayed with an original spelling." },
    ],
  },
];
