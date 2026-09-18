/* TEST set (vecto-plan item 19) — written 2026-09-17 from each file's published dictionary
   (listed in forTesting/newdomain/README.md), BEFORE any model request on these files.
   Run EXACTLY ONCE, on frozen prompts; no patch after reading it. Never edit an expectation
   to match an answer. See validation-expectations.mjs for how files were assigned. */

export const EXPECTATIONS = [
  {
    file: "newdomain/02-finance/german-credit.csv",
    targets: ["class"],
    roles: {
      class: ["binary"], Attribute1: ["categorical"], Attribute3: ["categorical"], Attribute4: ["categorical"],
      Attribute2: ["numeric"], Attribute5: ["numeric"], Attribute13: ["numeric"], Attribute9: ["categorical"],
      Attribute19: ["binary"], Attribute20: ["binary"],
    },
    // Names carry nothing; subtypes are checked only where the values settle them (A11-style codes, an amount).
    subtypes: {
      Attribute1: ["code", "category"], Attribute3: ["code", "category"], Attribute4: ["code", "category"],
      Attribute9: ["code", "category"], Attribute5: ["measurement"], Attribute2: ["measurement", "count"],
    },
  },
  {
    file: "newdomain/03-astronomy/kepler-exoplanets.csv",
    targets: ["koi_disposition", "koi_pdisposition"],
    roles: {
      // One star can host several KOIs: 8,214 distinct kepid over 9,564 rows.
      kepid: ["identifier"], kepoi_name: ["identifier"], koi_disposition: ["categorical"], koi_pdisposition: ["binary"],
      koi_score: ["numeric"], koi_fpflag_ss: ["binary"], koi_fpflag_co: ["binary"], koi_fpflag_ec: ["binary"],
      // A 0/1 flag with one stray 465 in the archive: 3 levels.
      koi_fpflag_nt: ["binary", "categorical"],
      koi_period: ["numeric"], koi_prad: ["numeric"], koi_steff: ["numeric"], ra: ["numeric"], dec: ["numeric"],
      koi_tce_delivname: ["categorical"],
    },
    subtypes: {
      kepid: ["identifier", "foreign_key"], kepoi_name: ["identifier"], kepler_name: ["entity_name", "identifier"],
      koi_disposition: ["category"], koi_fpflag_ss: ["flag"], koi_fpflag_co: ["flag"], koi_period: ["measurement"],
      koi_prad: ["measurement"], koi_steff: ["measurement"], koi_tce_delivname: ["category", "code"],
    },
  },
  {
    file: "newdomain/06-marketing/bank-additional.csv",
    targets: ["y"],
    roles: {
      age: ["numeric"], job: ["categorical"], marital: ["categorical"], education: ["categorical"],
      // no / yes / unknown ("unknown" is UCI's missing label): three written levels.
      default: ["categorical", "binary"], housing: ["categorical", "binary"],
      contact: ["binary"], month: ["categorical", "temporal"], day_of_week: ["categorical", "temporal"],
      duration: ["numeric"], campaign: ["numeric"], pdays: ["numeric"], previous: ["numeric"],
      poutcome: ["categorical"], euribor3m: ["numeric"], y: ["binary"],
    },
    subtypes: {
      duration: ["measurement"], campaign: ["count"], previous: ["count"], job: ["category"], month: ["date", "category"],
      euribor3m: ["measurement"], "cons.price.idx": ["measurement"], y: ["flag", "category"],
    },
  },
  {
    file: "newdomain/09-biology/mushroom.csv",
    targets: ["class"],
    roles: {
      class: ["binary"], odor: ["categorical"], "cap-shape": ["categorical"], bruises: ["binary"], "gill-size": ["binary"],
      "stalk-root": ["categorical"], habitat: ["categorical"], population: ["categorical"], "spore-print-color": ["categorical"],
    },
    subtypes: {
      class: ["code", "category", "flag"], odor: ["code", "category"], "cap-color": ["code", "category"],
      habitat: ["code", "category"], bruises: ["flag", "code", "category"],
    },
  },
  {
    file: "newdomain/11-census/adult.csv",
    targets: ["income"],
    roles: {
      age: ["numeric"], workclass: ["categorical"], fnlwgt: ["numeric"], education: ["categorical"],
      "marital-status": ["categorical"], occupation: ["categorical"], race: ["categorical"], sex: ["binary"],
      "capital-gain": ["numeric"], "hours-per-week": ["numeric"], "native-country": ["categorical"], income: ["binary"],
      // An ordinal code, one number per education level.
      "education-num": ["numeric", "categorical"],
    },
    subtypes: {
      // A census sampling weight.
      fnlwgt: ["measurement", "other"], "education-num": ["code", "category"], "capital-gain": ["measurement"],
      "hours-per-week": ["measurement", "count"], occupation: ["category"], income: ["category", "flag", "code"],
    },
    /* The canonical sensitive-attribute file (UCI Adult). `marital-status` and
       `relationship` are personal but are not in the closed list, so they are left
       unscored rather than forced into a value that does not fit. */
    sensitive: {
      age: ["age"], sex: ["sex_gender"], race: ["race_ethnicity"],
      "native-country": ["nationality_origin"], "hours-per-week": null, fnlwgt: null,
    },
  },
  {
    file: "newdomain/12-marine/abalone.csv",
    targets: ["Rings"],
    roles: {
      Sex: ["categorical"], Length: ["numeric"], Diameter: ["numeric"], Height: ["numeric"],
      "Whole weight": ["numeric"], "Shucked weight": ["numeric"], "Shell weight": ["numeric"], Rings: ["numeric"],
    },
    subtypes: {
      Sex: ["category", "code"], Length: ["measurement"], "Whole weight": ["measurement"], "Shell weight": ["measurement"],
      Rings: ["count", "measurement"],
    },
  },
  {
    file: "newdomain/13-ecommerce/online_shoppers_intention.csv",
    targets: ["Revenue"],
    roles: {
      Administrative: ["numeric"], Administrative_Duration: ["numeric"], ProductRelated: ["numeric"],
      BounceRates: ["numeric"], ExitRates: ["numeric"], PageValues: ["numeric"], Month: ["categorical", "temporal"],
      // Integer codes for operating system, browser, region and traffic source.
      OperatingSystems: ["categorical"], Browser: ["categorical"], Region: ["categorical"], TrafficType: ["categorical"],
      VisitorType: ["categorical"], Weekend: ["binary"], Revenue: ["binary"],
    },
    subtypes: {
      Administrative: ["count"], ProductRelated: ["count"], Administrative_Duration: ["measurement"],
      BounceRates: ["measurement"], PageValues: ["measurement"], Region: ["code", "category"],
      TrafficType: ["code", "category"], Browser: ["code", "category"], OperatingSystems: ["code", "category"],
      Month: ["date", "category"], Weekend: ["flag"], Revenue: ["flag", "category"],
    },
  },
  {
    file: "newdomain/14-clinical/parkinsons_updrs.csv",
    targets: ["total_UPDRS", "motor_UPDRS"],
    roles: {
      // 42 subjects, each measured ~140 times.
      "subject#": ["identifier", "categorical"], age: ["numeric"], sex: ["binary"], test_time: ["numeric", "temporal"],
      motor_UPDRS: ["numeric"], total_UPDRS: ["numeric"], "Jitter(%)": ["numeric"], HNR: ["numeric"], PPE: ["numeric"],
    },
    subtypes: {
      "subject#": ["identifier", "foreign_key"], test_time: ["measurement", "date"], motor_UPDRS: ["measurement"],
      total_UPDRS: ["measurement"], "Jitter(%)": ["measurement"], HNR: ["measurement"],
    },
  },
  {
    file: "newdomain/15-sensors/AirQualityUCI.csv",
    // UCI: the reference-analyser ground truths are what the sensor responses are used to estimate.
    targets: ["CO(GT)", "C6H6(GT)", "NOx(GT)", "NO2(GT)", "NMHC(GT)"],
    roles: {
      Date: ["temporal"], "PT08.S1(CO)": ["numeric"], "NOx(GT)": ["numeric"],
      // Decimal commas ("13,6"): numbers the engine cannot parse.
      "CO(GT)": ["numeric"], T: ["numeric"], RH: ["numeric"],
    },
    subtypes: {
      Date: ["date"], Time: ["date", "category"], "CO(GT)": ["measurement"], "PT08.S1(CO)": ["measurement"],
      T: ["measurement"], RH: ["measurement"],
    },
  },
  {
    file: "newdomain/17-hospitality/hotels.csv",
    targets: ["is_canceled", "adr"],
    roles: {
      hotel: ["binary"], is_canceled: ["binary"], lead_time: ["numeric"], arrival_date_month: ["categorical", "temporal"],
      adults: ["numeric"], babies: ["numeric"], meal: ["categorical"], country: ["categorical"],
      market_segment: ["categorical"], is_repeated_guest: ["binary"], reserved_room_type: ["categorical"],
      deposit_type: ["categorical"], customer_type: ["categorical"], adr: ["numeric"],
      reservation_status: ["categorical"], reservation_status_date: ["temporal"],
      // Dictionary: IDs of the travel agency and the company.
      agent: ["categorical", "identifier"], company: ["categorical", "identifier"],
    },
    subtypes: {
      lead_time: ["measurement", "count"], adults: ["count"], babies: ["count"], booking_changes: ["count"],
      previous_cancellations: ["count"], agent: ["foreign_key", "identifier", "code"], company: ["foreign_key", "identifier", "code"],
      country: ["code", "category"], reserved_room_type: ["code", "category"], adr: ["measurement"],
      reservation_status_date: ["date"], is_canceled: ["flag"],
    },
  },
];

export const LEAKAGE_EXPECTATIONS = [
  {
    file: "newdomain/02-finance/german-credit.csv",
    target: "class",
    leaks: {},
    clean: ["Attribute1", "Attribute2", "Attribute3", "Attribute5", "Attribute13"],
    split: ["random"],
  },
  {
    file: "newdomain/03-astronomy/kepler-exoplanets.csv",
    target: "koi_disposition",
    // Dictionary: pdisposition and score come from the same vetting; the fpflags are the reasons a KOI
    // is judged a false positive; kepler_name is filled on 2,746 of 2,748 CONFIRMED rows.
    leaks: {
      koi_pdisposition: ["restates_label", "derived_from_target"],
      koi_score: ["restates_label", "derived_from_target"],
      kepler_name: ["restates_label", "recorded_after_outcome", "derived_from_target"],
      koi_fpflag_nt: ["restates_label", "recorded_after_outcome", "derived_from_target"],
      koi_fpflag_ss: ["restates_label", "recorded_after_outcome", "derived_from_target"],
      koi_fpflag_co: ["restates_label", "recorded_after_outcome", "derived_from_target"],
      koi_fpflag_ec: ["restates_label", "recorded_after_outcome", "derived_from_target"],
    },
    clean: ["koi_steff", "koi_slogg", "ra", "dec", "koi_kepmag"],
  },
  {
    file: "newdomain/06-marketing/bank-additional.csv",
    target: "y",
    // UCI: duration is not known before the call, and y is known once it ends.
    leaks: { duration: ["recorded_after_outcome"] },
    clean: ["age", "job", "education", "marital", "euribor3m"],
    split: ["random", "time_ordered"],
  },
  {
    file: "newdomain/09-biology/mushroom.csv",
    target: "class",
    // odor nearly determines the class and is a legitimate field observation: the trap.
    leaks: {},
    clean: ["odor", "spore-print-color", "gill-size", "bruises", "habitat"],
    split: ["random"],
  },
  {
    file: "newdomain/11-census/adult.csv",
    target: "income",
    leaks: {},
    clean: ["age", "education", "hours-per-week", "occupation", "capital-gain"],
    split: ["random"],
  },
  {
    file: "newdomain/12-marine/abalone.csv",
    target: "Rings",
    leaks: {},
    clean: ["Shell weight", "Diameter", "Length", "Sex", "Whole weight"],
    split: ["random"],
  },
  {
    file: "newdomain/13-ecommerce/online_shoppers_intention.csv",
    target: "Revenue",
    // PageValues is built from pages visited before a transaction: defensible either way, so unlabelled.
    leaks: {},
    clean: ["Month", "VisitorType", "Region", "Weekend", "ProductRelated"],
    split: ["random", "time_ordered"],
  },
  {
    file: "newdomain/14-clinical/parkinsons_updrs.csv",
    target: "total_UPDRS",
    // The total UPDRS includes the motor section (total ≥ motor on 5875/5875 rows); 42 subjects are
    // each measured ~140 times, so a random split memorises the subject.
    leaks: { motor_UPDRS: ["derived_from_target", "restates_label"], "subject#": ["group_leak"] },
    clean: ["HNR", "RPDE", "DFA", "PPE", "Jitter(%)"],
    split: ["grouped"],
  },
  {
    file: "newdomain/17-hospitality/hotels.csv",
    target: "is_canceled",
    // Dictionary: reservation_status is Canceled / Check-Out / No-Show — the outcome itself — and its
    // date is when that status was set. assigned_room_type and booking_changes are left unlabelled.
    leaks: {
      reservation_status: ["restates_label", "recorded_after_outcome", "derived_from_target"],
      reservation_status_date: ["recorded_after_outcome"],
    },
    clean: ["lead_time", "hotel", "adults", "market_segment", "customer_type"],
  },
];

export const CLEANING_EXPECTATIONS = [
  {
    file: "newdomain/06-marketing/bank-additional.csv",
    // UCI: 999 means the client was not previously contacted — not a number of days.
    rules: [{ column: "pdays", types: ["treat_as_missing"] }],
  },
  {
    file: "newdomain/11-census/adult.csv",
    rules: [],
    // "<=50K" and ">50K" collide once symbols are dropped; they are the two opposite classes.
    forbidden: { income: ["merge_levels"] },
  },
  {
    file: "newdomain/15-sensors/AirQualityUCI.csv",
    // Decimal commas: "-200" (UCI's missing marker) collides with "20,0", and "1,4" with "-1,4".
    forbidden: { T: ["merge_levels"], RH: ["merge_levels"] },
  },
  { file: "newdomain/02-finance/german-credit.csv", rules: [] },
  { file: "newdomain/03-astronomy/kepler-exoplanets.csv", rules: [] },
  { file: "newdomain/09-biology/mushroom.csv", rules: [] },
  { file: "newdomain/12-marine/abalone.csv", rules: [] },
  { file: "newdomain/14-clinical/parkinsons_updrs.csv", rules: [] },
  { file: "newdomain/17-hospitality/hotels.csv", rules: [] },
];
