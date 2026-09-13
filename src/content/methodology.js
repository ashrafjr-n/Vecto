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
];
