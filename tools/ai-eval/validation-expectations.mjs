/* VALIDATION set (vecto-plan item 19) — written 2026-09-17 from each file's published
   dictionary (listed in forTesting/newdomain/README.md), BEFORE any model request on these
   files. Same rules as expectations.mjs: never edit one to match an answer; change one
   only when the file shows it was wrong, with the reason beside it.

   These files are never used to tune a prompt. Validation may be looked at between
   prompt versions (at most every 2–3); the test set (test-expectations.mjs) runs once.

   Assignment to validation vs test was made before any request, stratified by what a
   file exercises: files with a documented leak split 3 / 4, clean files 4 / 5, and one
   review-only file (no target) on each side.

   Checks are left out where the dictionary settles a column but the model cannot see why:
   StudentsPerformance `test preparation course` is "none"/"completed", and "none" is a
   missing token in the engine, so the profile shows one level. */

export const EXPECTATIONS = [
  {
    file: "newdomain/01-health/heart-disease.csv",
    targets: ["num"],
    roles: {
      age: ["numeric"], sex: ["binary"], cp: ["categorical"], trestbps: ["numeric"], chol: ["numeric"],
      fbs: ["binary"], restecg: ["categorical"], thalach: ["numeric"], exang: ["binary"], oldpeak: ["numeric"],
      slope: ["categorical"], thal: ["categorical"],
      // Dictionary: a count of vessels 0–3, but 4 small integers also read as a code.
      ca: ["numeric", "categorical"],
      // Diagnosis 0–4: an ordered severity, usually binarised.
      num: ["categorical", "numeric"],
    },
    subtypes: {
      cp: ["code", "category"], restecg: ["code", "category"], slope: ["code", "category"], thal: ["code", "category"],
      trestbps: ["measurement"], chol: ["measurement"], thalach: ["measurement"], ca: ["count"],
      fbs: ["flag"], exang: ["flag"], num: ["code", "category"],
    },
    /* Every clinical measurement here is a health attribute about a patient, and the
       target is a diagnosis. Labelled on the four that need no cardiology to read. */
    sensitive: {
      age: ["age"], sex: ["sex_gender"], chol: ["health"], trestbps: ["health"], num: ["health"],
    },
  },
  {
    file: "newdomain/04-education/StudentsPerformance.csv",
    targets: ["math score", "reading score", "writing score"],
    roles: {
      gender: ["binary"], "race/ethnicity": ["categorical"], "parental level of education": ["categorical"],
      lunch: ["binary"], "math score": ["numeric"], "reading score": ["numeric"], "writing score": ["numeric"],
    },
    subtypes: {
      "race/ethnicity": ["category", "code"], "parental level of education": ["category"],
      "math score": ["measurement"], "reading score": ["measurement"],
    },
    /* `lunch` is "standard"/"free or reduced" — a means-tested benefit, so it is an
       income proxy and not merely a meal. Deliberately labelled: a proxy is the case
       the closed list exists for. */
    sensitive: {
      gender: ["sex_gender"], "race/ethnicity": ["race_ethnicity"],
      lunch: ["financial_hardship"], "math score": null,
    },
  },
  {
    file: "newdomain/05-media/youtube_shorts_dataset.csv",
    // No target: one constant, one always "[]", a title and an id.
    roles: { "video.title": ["text"], "video.videoId": ["identifier"] },
    subtypes: { "video.title": ["free_text", "entity_name"], "video.videoId": ["identifier"] },
  },
  {
    file: "newdomain/07-mobility/bike-sharing-day.csv",
    targets: ["cnt", "casual", "registered"],
    roles: {
      instant: ["identifier"], dteday: ["temporal"], season: ["categorical"], yr: ["binary"],
      holiday: ["binary"], workingday: ["binary"], weathersit: ["categorical"],
      temp: ["numeric"], hum: ["numeric"], windspeed: ["numeric"],
      casual: ["numeric"], registered: ["numeric"], cnt: ["numeric"],
      mnth: ["categorical", "numeric", "temporal"],
    },
    subtypes: {
      instant: ["identifier"], dteday: ["date"], season: ["code", "category"], weathersit: ["code", "category"],
      casual: ["count"], registered: ["count"], cnt: ["count"], temp: ["measurement"], hum: ["measurement"],
    },
  },
  {
    file: "newdomain/08-chemistry/winequality-red.csv",
    targets: ["quality"],
    roles: {
      "fixed acidity": ["numeric"], "volatile acidity": ["numeric"], "residual sugar": ["numeric"],
      density: ["numeric"], pH: ["numeric"], sulphates: ["numeric"], alcohol: ["numeric"],
      // A 0–10 sensory grade with 6 levels in the file: a number or an ordered class.
      quality: ["numeric", "categorical"],
    },
    subtypes: {
      alcohol: ["measurement"], pH: ["measurement"], density: ["measurement"], "total sulfur dioxide": ["measurement"],
      quality: ["category", "code", "measurement"],
    },
  },
  {
    file: "newdomain/10-environment/forestfires.csv",
    targets: ["area"],
    roles: {
      month: ["categorical", "temporal"], day: ["categorical", "temporal"], FFMC: ["numeric"], DMC: ["numeric"],
      temp: ["numeric"], RH: ["numeric"], wind: ["numeric"], rain: ["numeric"], area: ["numeric"],
      // Grid cells 1–9 on the park map: a position, readable as a number or a code.
      X: ["numeric", "categorical"], Y: ["numeric", "categorical"],
    },
    subtypes: {
      month: ["date", "category"], day: ["date", "category"], temp: ["measurement"], RH: ["measurement"],
      wind: ["measurement"], area: ["measurement"],
    },
  },
  {
    file: "newdomain/16-agriculture/coffee_ratings.csv",
    targets: ["total_cup_points"],
    roles: {
      total_cup_points: ["numeric"], species: ["binary"], country_of_origin: ["categorical"],
      aroma: ["numeric"], flavor: ["numeric"], number_of_bags: ["numeric"], moisture: ["numeric"],
      altitude_mean_meters: ["numeric"], processing_method: ["categorical"], unit_of_measurement: ["binary"],
    },
    subtypes: {
      total_cup_points: ["measurement"], aroma: ["measurement"], number_of_bags: ["count"],
      category_one_defects: ["count"], category_two_defects: ["count"], altitude_mean_meters: ["measurement"],
      // "60 kg", "2 lbs": a weight written with its unit.
      bag_weight: ["measurement"], owner: ["entity_name"], farm_name: ["entity_name"], grading_date: ["date"],
    },
  },
  {
    file: "newdomain/18-cardiology/heart_failure_clinical_records.csv",
    targets: ["DEATH_EVENT"],
    roles: {
      age: ["numeric"], anaemia: ["binary"], diabetes: ["binary"], high_blood_pressure: ["binary"], sex: ["binary"],
      smoking: ["binary"], DEATH_EVENT: ["binary"], ejection_fraction: ["numeric"], platelets: ["numeric"],
      serum_creatinine: ["numeric"], serum_sodium: ["numeric"], time: ["numeric"],
    },
    subtypes: {
      anaemia: ["flag"], smoking: ["flag"], DEATH_EVENT: ["flag", "category"], creatinine_phosphokinase: ["measurement"],
      ejection_fraction: ["measurement"], platelets: ["measurement"], serum_creatinine: ["measurement"],
      // Follow-up period in days.
      time: ["measurement", "count"],
    },
  },
];

export const LEAKAGE_EXPECTATIONS = [
  {
    file: "newdomain/01-health/heart-disease.csv",
    target: "num",
    leaks: {},
    clean: ["age", "sex", "cp", "chol", "thalach"],
    split: ["random"],
  },
  {
    file: "newdomain/04-education/StudentsPerformance.csv",
    target: "math score",
    // The other two scores are from the same exam sitting: neither label is defensible, so unlabelled.
    leaks: {},
    clean: ["gender", "lunch", "test preparation course", "parental level of education"],
    split: ["random"],
  },
  {
    file: "newdomain/07-mobility/bike-sharing-day.csv",
    target: "cnt",
    // Readme: cnt is the count of casual AND registered users — exact on 731/731 rows.
    leaks: { casual: ["derived_from_target"], registered: ["derived_from_target"] },
    clean: ["temp", "season", "workingday", "hum", "weathersit"],
    split: ["time_ordered"],
  },
  {
    file: "newdomain/08-chemistry/winequality-red.csv",
    target: "quality",
    leaks: {},
    clean: ["alcohol", "volatile acidity", "sulphates", "pH"],
    split: ["random"],
  },
  {
    file: "newdomain/10-environment/forestfires.csv",
    target: "area",
    leaks: {},
    clean: ["temp", "RH", "wind", "month", "FFMC"],
  },
  {
    file: "newdomain/16-agriculture/coffee_ratings.csv",
    target: "total_cup_points",
    // The CQI total is the sum of the ten grades (exact to 0.02 on 1293/1339 rows; the rest
    // carry defect deductions, which is why the defect counts are left unlabelled).
    leaks: Object.fromEntries(["aroma", "flavor", "aftertaste", "acidity", "body", "balance", "uniformity", "clean_cup", "sweetness", "cupper_points"]
      .map((c) => [c, ["derived_from_target"]])),
    clean: ["country_of_origin", "species", "processing_method", "altitude_mean_meters", "number_of_bags"],
    split: ["random"],
  },
  {
    file: "newdomain/18-cardiology/heart_failure_clinical_records.csv",
    target: "DEATH_EVENT",
    // UCI: time is the follow-up period, which ends at death — known only after the outcome.
    leaks: { time: ["recorded_after_outcome"] },
    clean: ["serum_creatinine", "ejection_fraction", "age", "sex", "smoking"],
    split: ["random"],
  },
];

export const CLEANING_EXPECTATIONS = [
  {
    file: "newdomain/16-agriculture/coffee_ratings.csv",
    rules: [
      { column: "bag_weight", types: ["unit_map"], ratios: [["lbs", "kg", 0.45359237]] },
      // "msnm" is metres above sea level, so it shares the metre factor.
      { column: "altitude", types: ["unit_map"], ratios: [["ft", "m", 0.3048]] },
    ],
  },
  // No candidates: the right answer is no rule.
  { file: "newdomain/01-health/heart-disease.csv", rules: [] },
  { file: "newdomain/07-mobility/bike-sharing-day.csv", rules: [] },
  { file: "newdomain/08-chemistry/winequality-red.csv", rules: [] },
  { file: "newdomain/18-cardiology/heart_failure_clinical_records.csv", rules: [] },
];
