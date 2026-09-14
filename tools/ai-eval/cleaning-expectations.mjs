/* Known answers for the cleaning-proposal eval (AI phase D) — written 2026-09-14
   BEFORE any run against a real model, from the candidates the engine found on
   the corpus (see findCleaningCandidates) and what those values mean. Same rule as
   the other expectation files: never edit one to match an answer.

   Files with no candidates are skipped by the harness (nothing is asked).

   Each entry:
     rules      rules that must be proposed AND change values, one per column:
                  types    acceptable rule types
                  factors  { affix: factor } — absolute, within 2%
                  ratios   [[affix, baseAffix, ratio]] — factor(affix) / factor(base),
                           within 2%, for units whose base the model may choose
                  affixes  affixes that must be covered (censored bounds)
     forbidden  { column: [types] } that must NOT be proposed as an effective rule */

export const CLEANING_EXPECTATIONS = [
  {
    file: "house_prices.csv",
    rules: [
      { column: "Amount(in rupees)", types: ["unit_map"], factors: { lac: 100000, cr: 10000000 } },
      { column: "Carpet Area", types: ["unit_map"], ratios: [["sqyrd", "sqft", 9], ["sqm", "sqft", 10.7639]] },
      { column: "Super Area", types: ["unit_map"], ratios: [["sqyrd", "sqft", 9], ["sqm", "sqft", 10.7639]] },
    ],
    // "1 Covered" / "2 Open" count parking spaces of two KINDS; stripping the word loses the kind.
    forbidden: { "Car Parking": ["unit_map", "censored_numeric"] },
  },
  {
    file: "powerlifting/openpowerlifting.csv",
    rules: [
      // "125+" is the open super-heavyweight class: a lower bound, not 125 kg of something else.
      { column: "WeightClassKg", types: ["censored_numeric", "unit_map"], affixes: ["+"] },
      { column: "Division", types: ["merge_levels"] },
    ],
  },
  {
    file: "powerlifting/meets.csv",
    rules: [{ column: "MeetTown", types: ["merge_levels"] }],
  },
  {
    file: "heldout/mpg.csv",
    rules: [{ column: "name", types: ["merge_levels"] }],
  },
  {
    file: "football-events/events.csv",
    // "adria¡n" / "adrian": the same player, one spelling with broken encoding.
    rules: [{ column: "player_out", types: ["merge_levels"] }],
  },
  // Files the scan finds nothing in must stay quiet: listed so a false candidate would show up as a request.
  { file: "heldout/diamonds.csv", rules: [] },
  { file: "titanic-train.csv", rules: [] },
  { file: "football-events/ginf.csv", rules: [] },
];
