/* FINAL set (vecto-plan item 40) — written 2026-09-22 from each file's published dictionary
   (forTesting/final/README.md lists them), BEFORE any model request on these files.
   Nine files from domains and sources none of the 43 earlier test files came from. Run once;
   never edit an expectation to match an answer.

   Profiled with the engine before writing (0 requests): distinct counts and the engine's own
   roles were read, because the earlier sets did the same ("8,214 distinct kepid"). No model
   answer on these files existed when this was written.

   ENGINE_EXPECTATIONS is scored by tools/engine-check.mjs (0 requests); the other three
   exports by tools/ai-eval.mjs --set=final. */

export const EXPECTATIONS = [
  {
    file: "final/01-obesity/obesity.csv",
    targets: ["NObeyesdad"],
    roles: {
      Gender: ["binary"], Age: ["numeric"], Height: ["numeric"], Weight: ["numeric"],
      family_history_with_overweight: ["binary"], FAVC: ["binary"], SMOKE: ["binary"], SCC: ["binary"],
      CAEC: ["categorical"], CALC: ["categorical"], MTRANS: ["categorical"], NObeyesdad: ["categorical"],
    },
    subtypes: {
      Height: ["measurement"], Weight: ["measurement"], MTRANS: ["category"],
      family_history_with_overweight: ["flag", "category"], NObeyesdad: ["category"],
    },
    /* Survey answers of people. The target is an obesity level; the family history is of
       overweight. Smoking, eating and drinking habits are contested and left unscored. */
    sensitive: {
      Gender: ["sex_gender"], Age: ["age"], NObeyesdad: ["health"], family_history_with_overweight: ["health"],
      MTRANS: null,
    },
  },
  {
    file: "final/02-dropout/student-dropout.csv",
    targets: ["Target"],
    roles: {
      // UCI: integer codes, each number a named level.
      "Marital status": ["categorical"], "Application mode": ["categorical"], Course: ["categorical"],
      Nacionality: ["categorical"], "Previous qualification": ["categorical"],
      "Mother's occupation": ["categorical"], "Father's qualification": ["categorical"],
      "Admission grade": ["numeric"], "Age at enrollment": ["numeric"],
      Gender: ["binary"], Debtor: ["binary"], "Scholarship holder": ["binary"], International: ["binary"],
      "Curricular units 1st sem (approved)": ["numeric"], "Curricular units 2nd sem (grade)": ["numeric"],
      "Unemployment rate": ["numeric"], Target: ["categorical"],
    },
    subtypes: {
      "Marital status": ["code", "category"], "Application mode": ["code", "category"], Course: ["code", "category"],
      Nacionality: ["code", "category"], "Mother's occupation": ["code", "category"],
      "Admission grade": ["measurement"], "Curricular units 1st sem (approved)": ["count"],
      "Curricular units 1st sem (enrolled)": ["count"], Debtor: ["flag"], "Scholarship holder": ["flag"],
      Target: ["category"],
    },
    sensitive: {
      // UCI: "1 – male 0 – female"; nationality is a code list; special needs is a disability flag.
      Gender: ["sex_gender"], Nacionality: ["nationality_origin"], "Age at enrollment": ["age"],
      "Educational special needs": ["disability", "health"],
      "Admission grade": null, Course: null, "Unemployment rate": null, GDP: null, "Application order": null,
    },
  },
  {
    file: "final/03-diabetes/diabetic_data.csv",
    targets: ["readmitted"],
    roles: {
      encounter_id: ["identifier"],
      // UCI: "Unique identifier of a patient"; 71,518 patients over 101,766 encounters.
      patient_nbr: ["identifier", "categorical"],
      race: ["categorical"], gender: ["categorical", "binary"], age: ["categorical"],
      // UCI: integer identifiers mapped in IDS_mapping.csv.
      admission_type_id: ["categorical"], discharge_disposition_id: ["categorical"], admission_source_id: ["categorical"],
      time_in_hospital: ["numeric"], num_lab_procedures: ["numeric"], num_medications: ["numeric"],
      number_inpatient: ["numeric"],
      // UCI: "first three digits of ICD9" — codes, some starting with V or E.
      diag_1: ["categorical"], diag_2: ["categorical"],
      A1Cresult: ["categorical"], insulin: ["categorical"], change: ["binary"], diabetesMed: ["binary"],
      readmitted: ["categorical"],
    },
    subtypes: {
      encounter_id: ["identifier"], patient_nbr: ["identifier", "foreign_key"],
      admission_type_id: ["code", "category"], discharge_disposition_id: ["code", "category"],
      diag_1: ["code", "category"], time_in_hospital: ["count", "measurement"], num_medications: ["count"],
      number_inpatient: ["count"], num_lab_procedures: ["count"], readmitted: ["category"],
    },
    /* One row is a hospital encounter of a person: diagnoses and lab results are health.
       Payer (Medicaid vs private) and weight are contested and unscored. */
    sensitive: {
      race: ["race_ethnicity"], gender: ["sex_gender"], age: ["age"],
      diag_1: ["health"], A1Cresult: ["health"],
      admission_source_id: null, encounter_id: null,
    },
  },
  {
    file: "final/04-seoul-bike/SeoulBikeData.csv",
    targets: ["Rented Bike Count"],
    roles: {
      Date: ["temporal"], "Rented Bike Count": ["numeric"], Hour: ["numeric", "categorical"],
      // The file is Latin-1; read as UTF-8 (as the browser does) the degree sign becomes U+FFFD.
      "Temperature(�C)": ["numeric"], "Humidity(%)": ["numeric"], "Rainfall(mm)": ["numeric"],
      Seasons: ["categorical"], Holiday: ["binary"], "Functioning Day": ["binary"],
    },
    subtypes: {
      Date: ["date"], "Rented Bike Count": ["count"], "Temperature(�C)": ["measurement"],
      "Humidity(%)": ["measurement"], "Rainfall(mm)": ["measurement"], "Wind speed (m/s)": ["measurement"],
      Seasons: ["category"], Holiday: ["flag", "category"],
    },
    // One row is an hour of a city's bike system: nothing here is about a person.
    sensitive: {
      Hour: null, Seasons: null, Holiday: null, "Rented Bike Count": null, "Functioning Day": null,
    },
  },
  {
    file: "final/05-absenteeism/absenteeism.csv",
    targets: ["Absenteeism time in hours"],
    roles: {
      // 36 employees over 740 absences.
      ID: ["identifier", "categorical"],
      // UCI: ICD chapters I–XXI and codes 22–28.
      "Reason for absence": ["categorical"],
      "Day of the week": ["categorical", "numeric"], Seasons: ["categorical"], Education: ["categorical"],
      "Disciplinary failure": ["binary"], "Social drinker": ["binary"], "Social smoker": ["binary"],
      Son: ["numeric"], Pet: ["numeric"], Age: ["numeric"], Weight: ["numeric"], Height: ["numeric"],
      "Body mass index": ["numeric"], "Absenteeism time in hours": ["numeric"],
    },
    subtypes: {
      ID: ["identifier", "foreign_key"], "Reason for absence": ["code", "category"], Seasons: ["code", "category"],
      Education: ["code", "category"], Son: ["count"], Pet: ["count"], Weight: ["measurement"],
      "Body mass index": ["measurement"], "Absenteeism time in hours": ["measurement", "count"],
    },
    sensitive: {
      // The reason is a disease chapter of the ICD for most codes.
      Age: ["age"], "Reason for absence": ["health"],
      "Transportation expense": null, "Distance from Residence to Work": null, "Hit target": null,
    },
  },
  {
    file: "final/06-garment/garments_worker_productivity.csv",
    targets: ["actual_productivity"],
    roles: {
      date: ["temporal"], quarter: ["categorical"], department: ["binary", "categorical"], day: ["categorical"],
      // UCI: "Associated team number" — a label, not a quantity.
      team: ["categorical", "identifier"],
      targeted_productivity: ["numeric"], smv: ["numeric"], wip: ["numeric"], over_time: ["numeric"],
      incentive: ["numeric"], no_of_workers: ["numeric"], actual_productivity: ["numeric"],
    },
    subtypes: {
      date: ["date"], team: ["code", "category", "identifier", "foreign_key"], smv: ["measurement"],
      over_time: ["measurement"], incentive: ["measurement"], no_of_workers: ["count", "measurement"],
      idle_men: ["count"], actual_productivity: ["measurement"], targeted_productivity: ["measurement"],
    },
    // One row is a team's day: no person is described.
    sensitive: { team: null, incentive: null, day: null, department: null, no_of_workers: null },
  },
  {
    file: "final/07-himalaya/members.csv",
    targets: ["success", "died"],
    roles: {
      expedition_id: ["identifier", "categorical"], member_id: ["identifier"],
      peak_id: ["categorical", "identifier"], peak_name: ["categorical"], year: ["numeric", "temporal"],
      season: ["categorical"], sex: ["binary"], age: ["numeric"], citizenship: ["categorical"],
      hired: ["binary"], highpoint_metres: ["numeric"], success: ["binary"], oxygen_used: ["binary"],
      died: ["binary"], death_cause: ["categorical"], injured: ["binary"],
    },
    subtypes: {
      expedition_id: ["foreign_key", "identifier"], member_id: ["identifier"],
      peak_id: ["code", "foreign_key", "category", "identifier"], peak_name: ["entity_name", "category"],
      age: ["measurement"], highpoint_metres: ["measurement"], death_height_metres: ["measurement"],
      citizenship: ["category"], success: ["flag"], died: ["flag"],
    },
    sensitive: {
      sex: ["sex_gender"], age: ["age"], citizenship: ["nationality_origin"],
      peak_name: null, season: null, year: null,
    },
  },
  {
    file: "final/08-salary-survey/survey.csv",
    targets: ["annual_salary"],
    roles: {
      timestamp: ["temporal"], how_old_are_you: ["categorical"], industry: ["categorical"],
      annual_salary: ["numeric"], currency: ["categorical"], country: ["categorical"],
      additional_context_on_income: ["text"],
      overall_years_of_professional_experience: ["categorical"], highest_level_of_education_completed: ["categorical"],
      gender: ["categorical"], race: ["categorical"],
    },
    subtypes: {
      timestamp: ["date"], how_old_are_you: ["category"], annual_salary: ["measurement"],
      currency: ["category", "code"], additional_context_on_income: ["free_text"],
      overall_years_of_professional_experience: ["category"], country: ["category"],
    },
    /* Respondents describing themselves. Country is where they WORK, not their origin, and
       job/education are not on the closed list: contested, unscored. */
    sensitive: {
      how_old_are_you: ["age"], gender: ["sex_gender"], race: ["race_ethnicity"],
      industry: null, currency: null, timestamp: null,
    },
  },
  {
    file: "final/09-spotify/spotify_songs.csv",
    targets: ["track_popularity"],
    roles: {
      // A song listed in several playlists repeats: 28,356 tracks over 32,833 rows.
      track_id: ["identifier", "categorical"], track_album_id: ["identifier", "categorical"],
      playlist_id: ["identifier", "categorical"], track_popularity: ["numeric"],
      track_album_release_date: ["temporal"], playlist_genre: ["categorical"],
      danceability: ["numeric"], energy: ["numeric"], loudness: ["numeric"], tempo: ["numeric"],
      duration_ms: ["numeric"],
      // Pitch class 0–11 (-1 if none detected) and major = 1 / minor = 0.
      key: ["categorical"], mode: ["binary"],
    },
    subtypes: {
      track_id: ["identifier", "foreign_key"], track_album_id: ["foreign_key", "identifier"],
      playlist_id: ["foreign_key", "identifier"], key: ["code", "category"], mode: ["flag", "code", "category"],
      loudness: ["measurement"], tempo: ["measurement"], duration_ms: ["measurement"],
      track_album_release_date: ["date"], playlist_genre: ["category"],
    },
    // One row is a song in a playlist. Artist names are people but carry no listed attribute.
    sensitive: { playlist_genre: null, key: null, danceability: null, energy: null, track_popularity: null },
  },
];

export const LEAKAGE_EXPECTATIONS = [
  {
    file: "final/01-obesity/obesity.csv",
    target: "NObeyesdad",
    /* The label was assigned from BMI = weight / height² (Palechor & de la Hoz Manotas 2019,
       doi 10.1016/j.dib.2019.104344); measured before writing this: each class sits in its own
       BMI band. Weight carries most of it; Height alone does not, so it is left unlabelled. */
    leaks: { Weight: ["derived_from_target", "restates_label"] },
    clean: ["Age", "FAF", "CH2O", "MTRANS", "TUE"],
    split: ["random"],
  },
  {
    file: "final/02-dropout/student-dropout.csv",
    target: "Target",
    /* UCI: the outcome is the status at the end of the course's normal duration; semester
       results are recorded before it. They are strong, not leaked — unlabelled either way, since
       a model could defensibly call the 2nd semester late. */
    leaks: {},
    clean: ["Admission grade", "Age at enrollment", "Previous qualification (grade)", "Course", "Unemployment rate"],
    split: ["random"],
  },
  {
    file: "final/03-diabetes/diabetic_data.csv",
    target: "readmitted",
    /* UCI: patient_nbr identifies a patient with several encounters, so a random split puts the
       same patient on both sides. discharge_disposition_id includes "Expired" (a death, never
       readmitted) — known at discharge, so unlabelled. */
    leaks: { patient_nbr: ["group_leak"] },
    clean: ["time_in_hospital", "num_lab_procedures", "num_medications", "age", "admission_type_id"],
    split: ["grouped"],
  },
  {
    file: "final/04-seoul-bike/SeoulBikeData.csv",
    target: "Rented Bike Count",
    /* Functioning Day = No on exactly the 295 zero-count hours: known in advance (the system is
       off), yet it restates zero. Defensible either way — unlabelled. */
    leaks: {},
    clean: ["Hour", "Temperature(�C)", "Humidity(%)", "Seasons", "Rainfall(mm)"],
    split: ["time_ordered"],
  },
  {
    file: "final/05-absenteeism/absenteeism.csv",
    target: "Absenteeism time in hours",
    /* 36 employees over 740 rows: a random split memorises the employee. Reason 0 (not in the
       dictionary) and Disciplinary failure = 1 both go with 0 hours — undocumented, unlabelled. */
    leaks: { ID: ["group_leak"] },
    clean: ["Day of the week", "Seasons", "Month of absence", "Work load Average/day ", "Hit target"],
    split: ["grouped"],
  },
  {
    file: "final/06-garment/garments_worker_productivity.csv",
    target: "actual_productivity",
    // No documented leak. `incentive` may be paid on output — undocumented, unlabelled.
    leaks: {},
    clean: ["smv", "over_time", "no_of_workers", "day", "quarter"],
  },
  {
    file: "final/07-himalaya/members.csv",
    target: "success",
    /* Dictionary: highpoint_metres is the person's highest point — the summit height when they
       succeeded, known only after the climb. Members of one expedition share its outcome.
       death_* / injury_* are also recorded afterwards but describe another outcome: unlabelled. */
    leaks: {
      highpoint_metres: ["recorded_after_outcome", "restates_label", "derived_from_target"],
      expedition_id: ["group_leak"],
    },
    clean: ["age", "sex", "season", "hired", "year"],
    split: ["grouped", "time_ordered"],
  },
  {
    file: "final/08-salary-survey/survey.csv",
    target: "annual_salary",
    leaks: {},
    clean: ["industry", "how_old_are_you", "overall_years_of_professional_experience", "highest_level_of_education_completed", "gender"],
    split: ["random"],
  },
  {
    file: "final/09-spotify/spotify_songs.csv",
    target: "track_popularity",
    // A track repeats across playlists with the same popularity: a random split memorises it.
    leaks: { track_id: ["group_leak"] },
    clean: ["danceability", "energy", "loudness", "tempo", "duration_ms"],
    split: ["grouped"],
  },
];

export const CLEANING_EXPECTATIONS = [
  {
    file: "final/08-salary-survey/survey.csv",
    // "United States" / "UnitedStates", "US" / "U.S.", "USA" / "U.S.A.": one country written many ways.
    rules: [{ column: "country", types: ["merge_levels"] }],
  },
  {
    file: "final/03-diabetes/diabetic_data.csv",
    // "<30" and ">30" are opposite outcomes; ">7" and ">8" different results.
    forbidden: { readmitted: ["merge_levels"], A1Cresult: ["merge_levels"] },
  },
  { file: "final/01-obesity/obesity.csv", rules: [] },
  { file: "final/02-dropout/student-dropout.csv", rules: [] },
  { file: "final/04-seoul-bike/SeoulBikeData.csv", rules: [] },
];

/* The deterministic half (0 requests), scored by tools/engine-check.mjs. Every file must:
   parse and analyse without a throw; leave no column unaccounted (each non-target column is
   either scored against the target or listed in unscoredColumns with a reason); and produce a
   diagnostic whose "any signal" verdict matches the documentation below. `signal: null` means
   the documentation does not settle it — reported, not scored. */
export const ENGINE_EXPECTATIONS = [
  { file: "final/01-obesity/obesity.csv", target: "NObeyesdad", signal: true },
  { file: "final/02-dropout/student-dropout.csv", target: "Target", signal: true },
  { file: "final/03-diabetes/diabetic_data.csv", target: "readmitted", signal: true },
  { file: "final/04-seoul-bike/SeoulBikeData.csv", target: "Rented Bike Count", signal: true },
  { file: "final/05-absenteeism/absenteeism.csv", target: "Absenteeism time in hours", signal: true },
  { file: "final/06-garment/garments_worker_productivity.csv", target: "actual_productivity", signal: true },
  { file: "final/07-himalaya/members.csv", target: "success", signal: true },
  // Salaries in 11 currencies with free-typed outliers: the survey was not built to be modelled.
  { file: "final/08-salary-survey/survey.csv", target: "annual_salary", signal: null },
  { file: "final/09-spotify/spotify_songs.csv", target: "track_popularity", signal: true },
];
