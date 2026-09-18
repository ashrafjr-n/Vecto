/* Known answers for the leakage-review eval (AI phase C) — written 2026-09-14
   BEFORE any run against a real model, from what each file's columns record and
   the audit history. Same rule as expectations.mjs: never edit one to match an
   answer; change it only when the file shows the expectation was wrong, and say
   why beside it.

   Each entry:
     target  the column the review is run against
     leaks   { column: [acceptable categories] } — must be raised, in one of these
     clean   columns that must NOT be raised at all: legitimate predictors, often
             strongly associated with the target, which is exactly the trap
     split   acceptable strategies (omitted where more than one is defensible)

     relevance { column: [acceptable relevance categories] } — vecto-plan items 28/31,
             written 2026-09-18 BEFORE those categories exist in the schema, so no model
             answer could have shaped them. A relevance remark is NOT an accusation: it
             says the column's numbers and its meaning disagree, and it always renders as
             a question. `scoreLeakage` scores it on its own axis, and a leak category
             never satisfies a relevance expectation or the reverse.

             Deliberately short. Every entry below is a column whose engine association
             with the target is quoted beside it, and whose weakness has a known cause —
             not a column that merely feels important. Nothing is labelled
             `implausible_despite_signal`: the corpus has no case where a strong number
             is clearly meaningless AND is not already a leak, and inventing one would be
             labelling to fill a category.

   meets.csv and the mobile test.csv have no target and are not in this set. */

export const LEAKAGE_EXPECTATIONS = [
  {
    file: "heldout/taxis.csv",
    target: "fare",
    // total = fare + tip + tolls + fixed surcharges; the tip is set once the fare is known.
    leaks: { total: ["derived_from_target", "restates_label"], tip: ["recorded_after_outcome", "derived_from_target"] },
    clean: ["passengers", "color", "pickup_borough"],
    split: ["random", "time_ordered"],
  },
  {
    file: "heldout/titanic.csv",
    target: "survived",
    // alive is survived spelled yes/no.
    leaks: { alive: ["restates_label"] },
    clean: ["sex", "age", "pclass", "fare", "embarked"],
    split: ["random", "grouped"],
  },
  {
    file: "titanic-train.csv",
    target: "Survived",
    leaks: {},
    clean: ["Sex", "Pclass", "Age", "Fare", "Embarked"],
    split: ["random", "grouped"],
  },
  {
    file: "smoking.csv",
    target: "smoke",
    // Recorded only for smokers: amounts and cigarette type exist BECAUSE smoke = Yes.
    leaks: {
      amt_weekends: ["recorded_after_outcome", "restates_label", "derived_from_target"],
      amt_weekdays: ["recorded_after_outcome", "restates_label", "derived_from_target"],
      type: ["recorded_after_outcome", "restates_label", "derived_from_target"],
    },
    clean: ["gender", "age", "marital_status"],
    split: ["random"],
  },
  {
    file: "powerlifting/openpowerlifting.csv",
    target: "TotalKg",
    // TotalKg = BestSquatKg + BestBenchKg + BestDeadliftKg; Wilks is computed from the total; Place ranks totals.
    leaks: {
      BestSquatKg: ["derived_from_target"], BestBenchKg: ["derived_from_target"], BestDeadliftKg: ["derived_from_target"],
      Wilks: ["derived_from_target"], Place: ["recorded_after_outcome", "derived_from_target"],
    },
    clean: ["Sex", "Age", "BodyweightKg", "Equipment"],
    split: ["grouped"],
  },
  {
    file: "football-events/events.csv",
    target: "is_goal",
    // A goal is an on-target shot by definition, and the commentary announces it.
    leaks: { shot_outcome: ["restates_label", "recorded_after_outcome", "derived_from_target"], text: ["restates_label", "recorded_after_outcome"] },
    clean: ["side", "time", "event_team"],
  },
  {
    file: "house_prices.csv",
    target: "Price (in rupees)",
    // Price is per square foot; Amount is the whole price of the same listing.
    leaks: { "Amount(in rupees)": ["derived_from_target", "restates_label"] },
    clean: ["Bathroom", "Balcony", "facing", "Furnishing"],
    split: ["random"],
  },
  {
    file: "heldout/diamonds.csv",
    target: "price",
    leaks: {},
    clean: ["carat", "cut", "color", "clarity", "depth"],
    split: ["random"],
    /* The 4Cs ARE how a diamond is priced, yet carat (r 0.92) absorbs almost all of it,
       leaving cut 0.13, color 0.16, clarity 0.22 and depth 0.01 looking negligible.
       That is the textbook case of a real predictor with a weak marginal number. */
    relevance: {
      depth: ["plausible_despite_weak_signal"],
      cut:   ["plausible_despite_weak_signal"],
      clarity: ["plausible_despite_weak_signal"],
    },
  },
  {
    file: "heldout/mpg.csv",
    target: "mpg",
    leaks: {},
    clean: ["weight", "horsepower", "cylinders", "origin"],
  },
  {
    file: "heldout/penguins.csv",
    target: "species",
    leaks: {},
    clean: ["bill_length_mm", "flipper_length_mm", "island", "body_mass_g"],
    split: ["random"],
  },
  {
    file: "archive (1)/train.csv",
    target: "price_range",
    leaks: {},
    clean: ["ram", "battery_power", "px_height"],
    split: ["random"],
  },
  {
    file: "ai_student_impact_dataset.csv",
    target: "Post_Semester_GPA",
    leaks: {},
    clean: ["Major_Category", "Year_of_Study", "Paid_Subscription"],
    split: ["random"],
  },
  {
    file: "football-events/ginf.csv",
    target: "fthg",
    // Betting odds are published before kick-off — predictive, not leaked.
    leaks: {},
    clean: ["odd_h", "odd_d", "odd_a", "league"],
  },
  {
    file: "heldout/flights.csv",
    target: "passengers",
    leaks: {},
    clean: ["month"],
    split: ["time_ordered"],
    /* Air travel is strongly seasonal, and everyone knows it — but the 1949-60 growth
       trend dominates so completely that month scores η 0.03 against passengers. The
       number says "no signal"; the meaning says "obvious signal". */
    relevance: { month: ["plausible_despite_weak_signal"] },
  },
  {
    file: "heldout/sonar.csv",
    target: "R",
    leaks: {},
    clean: ["0.0200", "0.0371"],
    split: ["random"],
  },
];
