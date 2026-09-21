/* HARD-NAMES set (vecto-plan item 30) — written 2026-09-21 from each file's published
   dictionary (listed in forTesting/hardnames/README.md), BEFORE any model request on
   these files. Same rules as every other expectation file: never edit one to match an
   answer; change one only when the file shows it was wrong, with the reason beside it.

   Why this set exists: the 18-file corpus and the 18 new-domain files are all clean
   English column names. `sensitive` (item 29) is scored there on names a person reads at
   a glance — `sex`, `race/ethnicity`, `lunch`. This set asks the harder question: does
   the model read the DATA, or the English word in the header?

   | file | what it exercises |
   |---|---|
   | 01 qa-employment | Arabic names, one of them a code (`رمز النشاط`) |
   | 02 qa-deaths | Arabic names where the sex column is called `النوع` ("type") |
   | 03 fr-arbres | French names on trees — `genre` is a botanical genus, not gender |
   | 04 student-mat | abbreviated codes (Medu, Fedu, Pstatus, Dalc, Walc, G1–G3) |
   | 05 boston-housing | abbreviated codes where `age` is a HOUSING age and `b` is a race proxy |
   | 06 compas | proxy-heavy, and a criminal record is NOT on the closed list |
   | 07 autism-screening | misspelled names (`jundice`, `austim`, `contry_of_res`) + item codes |

   **The bar (vecto-plan item 30): precision ≥ 90%** — of the columns the model calls
   sensitive, how many are labelled sensitive here. Recall is REPORTED per name type
   (Arabic / coded / misspelled / plain) and carries no bar: a model cannot know from
   `b` alone that it encodes a town's racial composition, and failing to guess is not the
   same defect as inventing an attribute.

   **One tension is recorded here BEFORE the run, not explained away after it.** The
   prompt's rule for `sensitive` opens with "ask what one row is first", and its examples
   are files whose rows are not people (a penguin, a diamond, a car). Files 01 and 02 are
   AGGREGATE tables: one row is a count of people, not a person. These labels say
   `الجنس` and `النوع` are sensitive there, because the column records that attribute of
   the people being counted — a published table of deaths by sex is a table about people.
   A model that follows the row-grain rule literally will answer null and lose RECALL,
   which carries no bar; it cannot lose precision this way. Whichever way the answers
   fall, the result is a finding about the rule's reach, and the labels were written
   first so that finding cannot be manufactured afterwards.

   Labels are only the unambiguous cases, both ways. `null` is a real check — it fails
   when the model invents an attribute. Left UNSCORED where the closed list has no
   fitting value (marital status, occupation, a criminal record, a risk score) or where
   the call is genuinely contested (`address` urban/rural, `Medu`/`Fedu`, `internet`,
   `romantic`) — a contested label would measure the author, not the model. */

export const EXPECTATIONS = [
  {
    /* Qatar Planning and Statistics Authority, via data.gov.qa. One row is a COUNT of
       employees for a (year, activity, nationality, sex) cell — not a person. The sex
       and nationality columns still RECORD those attributes of the people counted,
       which is why they are labelled where a penguin's `sex` is not: the rows are
       about people, just aggregated. */
    file: "hardnames/01-qatar-employment/qa-employment.csv",
    roles: {
      "النشاط الاقتصادي الرئيسي": ["categorical"], "الجنسية": ["binary", "categorical"],
      "الجنس": ["binary"], "القيمة": ["numeric"],
    },
    subtypes: {
      // `رمز` is Arabic for "code". The column arrives as a number; it is not a quantity.
      " رمز النشاط": ["code", "category", "identifier"],
      "النشاط الاقتصادي الرئيسي": ["category"], "القيمة": ["count", "measurement"],
    },
    sensitive: {
      "الجنس": ["sex_gender"], "الجنسية": ["nationality_origin"],
      "السنة": null, " رمز النشاط": null, "القيمة": null,
      // An economic activity is an occupation, and occupation is not on the closed list.
      "النشاط الاقتصادي الرئيسي": null,
    },
  },
  {
    /* Registered deaths of Qataris aged 15+, by marital status, sex and age group.
       `النوع` literally means "type"; its values are ذكور / إناث (male / female), so the
       attribute is readable only from the VALUES, never from the name. */
    file: "hardnames/02-qatar-deaths/qa-deaths.csv",
    roles: {
      "الفئات العمرية (بالسنوات)": ["categorical"], "النوع": ["binary"],
      "الحالة الزواجية": ["categorical"], "العدد": ["numeric"],
    },
    subtypes: { "العدد": ["count"], "الفئات العمرية (بالسنوات)": ["category", "code"] },
    sensitive: {
      "النوع": ["sex_gender"], "الفئات العمرية (بالسنوات)": ["age"],
      "السنة": null, "العدد": null,
      /* `الحالة الزواجية` (marital status) is left UNSCORED, as `marital-status` is in
         the adult corpus: the closed list has no value for it and inventing one here
         would score the list, not the model. */
    },
  },
  {
    /* Paris remarkable trees (opendata.paris.fr). Nothing in this file is about a
       person, so every sensitive check is a null — this is the precision file. `genre`
       is French for the botanical GENUS (Aesculus, Platanus); a model reading the word
       as "gender" fails here exactly as it would on a penguin's `sex`. */
    file: "hardnames/03-paris-trees/fr-arbres.csv",
    roles: {
      "genre": ["categorical"], "espèce": ["categorical"], "hauteur en m": ["numeric"],
      "circonference en cm": ["numeric"], "date de plantation": ["temporal"],
      "Descriptif": ["text"],
    },
    subtypes: {
      "genre": ["category"], "hauteur en m": ["measurement"], "circonference en cm": ["measurement"],
      "date de plantation": ["date"], "Descriptif": ["free_text"],
    },
    sensitive: {
      "genre": null, "espèce": null, "hauteur en m": null, "circonference en cm": null,
      "arrondissement": null, "Année de plantation": null, "Dénomination botanique": null,
    },
  },
  {
    /* UCI Student Performance (Cortez & Silva, 2008), Portuguese secondary schools —
       dictionary in the same folder (student.txt). Row = one pupil, so the person
       attributes here are real. */
    file: "hardnames/04-portugal-students/student-mat.csv",
    targets: ["G3"],
    roles: {
      sex: ["binary"], age: ["numeric"], Medu: ["numeric", "categorical"], Fedu: ["numeric", "categorical"],
      Mjob: ["categorical"], Fjob: ["categorical"], Dalc: ["numeric", "categorical"],
      Walc: ["numeric", "categorical"], health: ["numeric", "categorical"], absences: ["numeric"],
      G1: ["numeric"], G2: ["numeric"], G3: ["numeric"],
    },
    subtypes: {
      Medu: ["code", "category"], Fedu: ["code", "category"], Dalc: ["code", "category", "measurement"],
      Walc: ["code", "category", "measurement"], health: ["code", "category", "measurement"],
      absences: ["count"], G3: ["measurement", "count"], Mjob: ["category"],
    },
    sensitive: {
      sex: ["sex_gender"], age: ["age"],
      // Dictionary: "current health status (numeric: from 1 - very bad to 5 - very good)".
      health: ["health"],
      // Dictionary: workday / weekend alcohol consumption, 1–5. A health attribute of a minor.
      Dalc: ["health"], Walc: ["health"],
      /* `Mjob` takes the VALUE "health" (a parent who works in health care). The column
         records an occupation, not the pupil's health — a name/value trap in one column. */
      Mjob: null, Fjob: null,
      G3: null, absences: null, school: null,
      /* UNSCORED, contested: address (U/R), famsize, Pstatus, Medu, Fedu, internet, paid,
         romantic. Each is arguably a socioeconomic or personal proxy, and item 28's rule
         is that a contested label measures the labeller. */
    },
  },
  {
    /* Boston housing (Harrison & Rubinfeld, 1978) as distributed by CMU StatLib. One row
       is a census tract, and the names are three- to five-letter codes. */
    file: "hardnames/05-boston-housing/boston-housing.csv",
    targets: ["medv"],
    roles: { crim: ["numeric"], nox: ["numeric"], rm: ["numeric"], age: ["numeric"], chas: ["binary"], medv: ["numeric"] },
    subtypes: { crim: ["measurement"], nox: ["measurement"], rm: ["measurement", "count"], chas: ["flag"], medv: ["measurement"] },
    sensitive: {
      /* Dictionary: `b` is 1000(Bk − 0.63)² where Bk is the proportion of Black residents
         by town. It is a race variable, transformed. Nothing in the NAME says so, which is
         the point: this is a recall case, and missing it is not a precision failure. */
      b: ["race_ethnicity"],
      /* Dictionary: "% lower status of the population" — the file's poverty share. */
      lstat: ["financial_hardship"],
      /* THE TRAP: `age` here is "proportion of owner-occupied units built prior to 1940".
         It is the age of HOUSING, not of a person. */
      age: null,
      rm: null, nox: null, chas: null, tax: null, ptratio: null, medv: null,
    },
  },
  {
    /* ProPublica COMPAS, two-year recidivism (2016). Person-level, and the file is the
       canonical proxy-heavy dataset. */
    file: "hardnames/06-compas-recidivism/compas-two-years.csv",
    targets: ["two_year_recid", "is_recid"],
    roles: {
      sex: ["binary"], race: ["categorical"], age: ["numeric"], age_cat: ["categorical"],
      dob: ["temporal"], priors_count: ["numeric"], two_year_recid: ["binary"],
      decile_score: ["numeric", "categorical"], name: ["identifier"],
    },
    subtypes: {
      age: ["measurement", "count"], age_cat: ["category"], dob: ["date"],
      priors_count: ["count"], two_year_recid: ["flag"], name: ["entity_name", "identifier"],
    },
    sensitive: {
      sex: ["sex_gender"], race: ["race_ethnicity"], age: ["age"], age_cat: ["age"],
      // A date of birth carries the person's age exactly.
      dob: ["age"],
      /* A criminal record is not on the closed list, and `null` is therefore the only
         answer the schema allows. This is a real check: the list is closed on purpose. */
      priors_count: null, c_charge_degree: null, two_year_recid: null,
      /* UNSCORED: decile_score / v_decile_score / score_text. The famous finding about
         this file is that the score is a race proxy; whether a risk score IS a sensitive
         attribute is exactly the contested call these labels stay out of. */
    },
  },
  {
    /* UCI Autism Screening Adult (Thabtah, 2017). The column names carry the source's own
       misspellings — `jundice`, `austim`, `contry_of_res` — and ten screening items named
       only by index. Description document in the same folder. */
    file: "hardnames/07-autism-screening/autism-screening.csv",
    targets: ["Class/ASD", "result"],
    roles: {
      A1_Score: ["binary"], age: ["numeric"], gender: ["binary"], ethnicity: ["categorical"],
      jundice: ["binary"], austim: ["binary"], contry_of_res: ["categorical"],
      result: ["numeric"], "Class/ASD": ["binary"],
    },
    subtypes: {
      A1_Score: ["flag", "code"], age: ["measurement", "count"], jundice: ["flag"], austim: ["flag"],
      contry_of_res: ["category"], result: ["measurement", "count"], "Class/ASD": ["flag"],
    },
    sensitive: {
      gender: ["sex_gender"], ethnicity: ["race_ethnicity"], age: ["age"],
      // "age_desc" is the age band the respondent falls in ("18 and more").
      age_desc: ["age"],
      // Misspelled in the source: jaundice at birth, and a family member with autism.
      jundice: ["health"], austim: ["health"],
      contry_of_res: ["nationality_origin"],
      // The screening score and its outcome are a health assessment of the respondent.
      result: ["health"], "Class/ASD": ["health"],
      /* One screening item is labelled, not all ten: ten near-identical checks would
         inflate the count without measuring anything new. A2–A10 stay unscored. */
      A1_Score: ["health"],
      used_app_before: null, relation: null,
    },
  },
];

/* No leakage or cleaning expectations: this set exists to measure `sensitive` on hard
   column names, and adding half-considered labels for two other tasks would dilute a
   precision figure that is the whole point. Both are exported empty so `--set=hardnames`
   loads for any task without pretending to score one it has no labels for. */
export const LEAKAGE_EXPECTATIONS = [];
export const CLEANING_EXPECTATIONS = [];
