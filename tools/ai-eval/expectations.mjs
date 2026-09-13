/* Known answers for the column-dossier eval — written 2026-09-14 BEFORE the first
   run against a real model, from the data dictionaries and the audit history of
   each file (see CLAUDE.md stages 9–10e). Never edit an expectation to match an
   answer; change one only when the file itself shows the expectation was wrong,
   and say why in a comment beside it.

   Paths are relative to forTesting/ (gitignored). Each entry:
     targets   columns a sensible model would predict, any order (omitted = the
               file has no real target, so target picks are not scored)
     roles     { column: [acceptable roles] }
     subtypes  { column: [acceptable subtypes] }

   Acceptable sets are deliberately generous where a column is genuinely
   ambiguous (a year can be numeric or temporal) and strict where the audit
   settled the question (a repeated MeetID is a key, not a measurement). */

export const EXPECTATIONS = [
  {
    file: "titanic-train.csv",
    targets: ["Survived"],
    roles: {
      PassengerId: ["identifier"], Survived: ["binary"], Pclass: ["categorical"],
      Sex: ["binary"], Age: ["numeric"], SibSp: ["numeric"], Parch: ["numeric"], Fare: ["numeric"],
    },
    subtypes: {
      PassengerId: ["identifier"], Name: ["entity_name", "identifier"], SibSp: ["count"],
      Parch: ["count"], Fare: ["measurement"], Pclass: ["code", "category"], Embarked: ["code", "category"],
    },
  },
  {
    file: "smoking.csv",
    targets: ["smoke"],
    roles: { column_1: ["identifier"], smoke: ["binary"], age: ["numeric"], amt_weekends: ["numeric"], amt_weekdays: ["numeric"] },
    subtypes: { column_1: ["identifier"], amt_weekends: ["count", "measurement"], gross_income: ["category", "code"] },
  },
  {
    file: "powerlifting/meets.csv",
    roles: { MeetID: ["identifier"], MeetPath: ["identifier"], Date: ["temporal"], MeetCountry: ["categorical"] },
    subtypes: { MeetID: ["identifier"], Date: ["date"], MeetName: ["entity_name", "free_text", "category"] },
  },
  {
    file: "powerlifting/openpowerlifting.csv",
    targets: ["TotalKg", "Wilks", "Place", "BestSquatKg", "BestBenchKg", "BestDeadliftKg"],
    roles: { MeetID: ["identifier"], Sex: ["binary"], Age: ["numeric"], BodyweightKg: ["numeric"], TotalKg: ["numeric"] },
    // MeetID repeats (a key into meets.csv); WeightClassKg holds "125+" open classes.
    subtypes: { MeetID: ["foreign_key", "identifier"], Name: ["entity_name", "identifier"], BodyweightKg: ["measurement"], WeightClassKg: ["category", "code", "measurement"] },
  },
  {
    file: "football-events/events.csv",
    targets: ["is_goal", "event_type", "shot_outcome", "shot_place", "location"],
    // The published dictionary: these four integer columns are CODES, not measurements.
    roles: { id_odsp: ["identifier"], text: ["text"], is_goal: ["binary"], event_type: ["categorical"], shot_place: ["categorical"], location: ["categorical"], assist_method: ["categorical"] },
    subtypes: { id_odsp: ["foreign_key", "identifier"], event_type: ["code"], shot_place: ["code"], location: ["code"], assist_method: ["code"], text: ["free_text"], time: ["measurement", "count"] },
  },
  {
    file: "football-events/ginf.csv",
    targets: ["fthg", "ftag"],
    roles: { id_odsp: ["identifier"], link_odsp: ["identifier"], date: ["temporal"], fthg: ["numeric"], ftag: ["numeric"], odd_h: ["numeric"] },
    subtypes: { fthg: ["count"], ftag: ["count"], odd_h: ["measurement"], ht: ["entity_name", "category"] },
  },
  {
    file: "house_prices.csv",
    targets: ["Price (in rupees)", "Amount(in rupees)"],
    roles: { Index: ["identifier"], Title: ["text"], Description: ["text"], Bathroom: ["numeric"] },
    // "42 Lac", "500 sqft": numbers written with units inside the value.
    subtypes: { "Amount(in rupees)": ["measurement"], "Carpet Area": ["measurement"], Bathroom: ["count"], Description: ["free_text"] },
  },
  {
    file: "ai_student_impact_dataset.csv",
    targets: ["Post_Semester_GPA", "Burnout_Risk_Level", "Skill_Retention_Score"],
    roles: { Student_ID: ["identifier"], Paid_Subscription: ["binary"], Post_Semester_GPA: ["numeric"], Weekly_GenAI_Hours: ["numeric"] },
    subtypes: { Student_ID: ["identifier"], Weekly_GenAI_Hours: ["measurement"], Tool_Diversity: ["count", "measurement"], Burnout_Risk_Level: ["category", "code"] },
  },
  {
    file: "archive (1)/train.csv",
    targets: ["price_range"],
    roles: { price_range: ["categorical"], blue: ["binary"], ram: ["numeric"], battery_power: ["numeric"] },
    subtypes: { price_range: ["code", "category"], blue: ["flag"], n_cores: ["count"], ram: ["measurement"] },
  },
  {
    file: "archive (1)/test.csv",
    // The same phones with no price_range: there is nothing to predict here.
    roles: { id: ["identifier"], blue: ["binary"], ram: ["numeric"] },
    subtypes: { id: ["identifier"], blue: ["flag"], n_cores: ["count"] },
  },
  {
    file: "heldout/diamonds.csv",
    targets: ["price"],
    roles: { carat: ["numeric"], cut: ["categorical"], color: ["categorical"], clarity: ["categorical"], price: ["numeric"] },
    subtypes: { carat: ["measurement"], x: ["measurement"], price: ["measurement"], cut: ["category", "code"] },
  },
  {
    file: "heldout/flights.csv",
    targets: ["passengers"],
    roles: { passengers: ["numeric"], year: ["numeric", "temporal", "categorical"], month: ["categorical", "temporal"] },
    subtypes: { passengers: ["count"], year: ["date", "measurement", "category"], month: ["date", "category"] },
  },
  {
    file: "heldout/mpg.csv",
    targets: ["mpg"],
    roles: { mpg: ["numeric"], weight: ["numeric"], origin: ["categorical"], horsepower: ["numeric"] },
    subtypes: { mpg: ["measurement"], weight: ["measurement"], name: ["entity_name", "category"], origin: ["category", "code"] },
  },
  {
    file: "heldout/penguins.csv",
    targets: ["species"],
    roles: { species: ["categorical"], island: ["categorical"], sex: ["binary"], body_mass_g: ["numeric"] },
    subtypes: { body_mass_g: ["measurement"], bill_length_mm: ["measurement"], species: ["category"] },
  },
  {
    file: "heldout/sonar.csv",
    // Headerless: the first data row became the column names. "R" is the label column.
    targets: ["R"],
    roles: { R: ["binary"] },
    subtypes: { R: ["flag", "category", "code"] },
  },
  {
    file: "heldout/taxis.csv",
    targets: ["fare", "total", "tip"],
    roles: { pickup: ["temporal"], dropoff: ["temporal"], fare: ["numeric"], total: ["numeric"], passengers: ["numeric"], color: ["binary"], payment: ["binary"] },
    subtypes: { pickup: ["date"], fare: ["measurement"], passengers: ["count"], pickup_zone: ["category", "entity_name"] },
  },
  {
    file: "heldout/titanic.csv",
    targets: ["survived"],
    roles: { survived: ["binary"], sex: ["binary"], age: ["numeric"], fare: ["numeric"], alive: ["binary"], deck: ["categorical"] },
    subtypes: { sibsp: ["count"], fare: ["measurement"], pclass: ["code", "category"], alive: ["flag", "category"] },
  },
  {
    file: "heldout/yelp.csv",
    targets: ["stars"],
    roles: { business_id: ["identifier"], review_id: ["identifier"], user_id: ["identifier"], text: ["text"], date: ["temporal"] },
    subtypes: { business_id: ["foreign_key", "identifier"], user_id: ["foreign_key", "identifier"], text: ["free_text"], cool: ["count"], useful: ["count"], funny: ["count"] },
  },
];
