/* Copy for the plain reading pages (/about, /privacy, /terms), rendered by
   pages/TextPage.jsx. Each section is { id, title, body: [paragraph | { list }] }.

   /privacy states facts about the running app — what each AI task sends, the
   answer cache, analytics, hosting. If one of those changes (a new AI task, a new
   payload field, a new third-party script), this copy is wrong until it changes
   too; nothing links the two. */

const UPDATED = "22 September 2026";
const GITHUB = "https://github.com/ashrafjr-n/vecto";

/* /about is its own page (pages/About.jsx), not a TextPage: it is the one place
   that says what the product is and refuses to be, and that opposition is the
   layout. Shape: a masthead, a colophon, two opposed columns, a build ledger. */
export const ABOUT = {
  kicker: "About",
  title: "A dataset analyzer that shows its working.",
  lead: [
    "Vecto is for the hour before training: you have a CSV, you know roughly what you want to predict, and you do not yet know what the file will and will not support. Drop it in, pick the column, and read what is actually there.",
    "It is one person's tool, built in the open, and it states its own limits as plainly as its findings — including where the answer is “this cannot be decided from the data”.",
  ],
  facts: [
    { label: "Where it runs",    value: "Your browser tab" },
    { label: "Rows uploaded",    value: "0" },
    { label: "Report sections",  value: "8" },
    { label: "Tested on",        value: "40+ datasets" },
  ],
  does: {
    title: "What it does",
    rows: [
      { label: "Reads the columns", text: "Each column's role — identifier, temporal, binary, numeric, categorical or free text — is inferred from its values over the whole column, never from its name and never from a head sample." },
      { label: "Measures the file", text: "Missing values, duplicates, mixed types, distributions and outliers, correlations between features, and every column against the target with the metric its type allows — including the ones that restate the target." },
      { label: "Says what to do",   text: "Prioritised advice, a per-column preparation plan, a linear baseline as a measurement of how much signal is there, and a scikit-learn script that repeats exactly what the plan describes." },
      { label: "Shows its reasons", text: "A coefficient arrives with its p-value and sample size, a capped score with what capped it, and a column the engine could not measure is named as unmeasured rather than shown as clean." },
    ],
  },
  isNot: {
    title: "What it is not",
    rows: [
      { label: "Not a training tool", text: "It does not train or tune models. The one baseline model in the report exists to measure whether the columns carry signal at all; it is a floor, not a result to use." },
      { label: "Not a data store",    text: "There is no server that receives files. Nothing is uploaded, nothing is kept, and closing the tab ends it." },
      { label: "Not an oracle",       text: "The engine sees values, not meaning. Whether a column was recorded after the outcome, or an outlier is an error rather than a real event, is handed back to you — stated, not guessed." },
    ],
  },
  built: {
    title: "How it is built",
    rows: [
      { label: "A deterministic engine", text: "Pure JavaScript in a background worker in your tab. The same file and the same target produce the same report, every time. Its statistics are checked against pandas and scipy to a 1e-6 tolerance by a test suite that runs on every change." },
      { label: "Tested on real files",   text: "Every rule and threshold was run against more than 40 public datasets — and the held-out ones were written up before they were ever run, so a threshold could not be fitted to them after the fact." },
      { label: "AI as the last layer",   text: "An optional review suggests what columns mean, which may leak the target and how dirty values could be cleaned. Every claim is checked against the file, labelled as AI, and changes the report only when you accept it." },
    ],
  },
  source: { link: GITHUB, text: "The source is on GitHub — issues, questions and corrections are welcome there." },
};

export const PRIVACY = {
  title: "Privacy",
  lead: [
    "Vecto analyses your file in your browser. This page lists everything that does leave it.",
  ],
  updated: UPDATED,
  sections: [
    {
      id: "file",
      title: "Your file",
      body: [
        "The CSV you drop is read and analysed in this browser tab, in a background worker. It is never uploaded: there is no server that receives files. Reloading or closing the tab discards it.",
      ],
    },
    {
      id: "ai",
      title: "The optional AI review",
      body: [
        "Nothing is sent to a language model until you press a review button. When you do, Vecto's server (a Cloudflare Worker, which does not store the request) forwards a summary of the file to OpenRouter, which passes it to a model provider. The request never contains rows.",
        { list: [
          "Column review: column names; per-column counts, share missing and summary statistics; up to 8 frequent values and 5 example values per column, each cut to 60 characters; and for values the engine flags as dirty, the unit, spelling or placeholder with its count and up to 3 examples. Free-text columns send only their average length.",
          "Leakage review: column names and roles, the engine's measured associations with the target and column means — no cell values. If you asked for a column review first, its column meanings are included.",
        ] },
        "The models in use are free endpoints, whose providers may log requests and use them for training. Do not ask for a review of a file whose column names or example values you cannot share on those terms.",
        "After your first review request, the leakage review of each new report in the same visit is requested automatically. Leaving the page ends that. Every panel has a “See exactly what is sent” link that shows the request before you make it.",
      ],
    },
    {
      id: "storage",
      title: "Stored in your browser",
      body: [
        "Successful AI answers are kept in this browser's local storage — at most 20, under the key vecto.ai.answers — so asking the same question about the same file costs no second request. They never leave the browser. The Clear link under an answer deletes them, and so does clearing the site's data. Vecto stores nothing else; the analytics below sets its own cookies.",
      ],
    },
    {
      id: "analytics",
      title: "Analytics",
      body: [
        "The site uses Google Analytics to count visits and the pages viewed. Google receives the page address, basic browser and device information and your IP address, and sets cookies to recognise a returning browser. It does not receive your file or anything in the report.",
      ],
    },
    {
      id: "hosting",
      title: "Hosting and fonts",
      body: [
        "Pages are served by Cloudflare, which receives the technical details of each request, such as your IP address. Fonts are loaded from Google Fonts, which receives the same kind of request data.",
      ],
    },
    {
      id: "accounts",
      title: "Accounts",
      body: [
        "There are no accounts yet. When sign-in is switched on, this page will say what it stores first.",
      ],
    },
    {
      id: "contact",
      title: "Contact",
      body: [
        { link: GITHUB, text: "Questions about privacy can be raised as an issue on GitHub." },
      ],
    },
  ],
};

/* Provisional on purpose (the owner's call, 2026-09-22): the page exists now and is
   completed when sign-in arrives. Not reviewed by a lawyer. */
export const TERMS = {
  title: "Terms of use",
  lead: [
    "Provisional terms for the current version of Vecto, which has no accounts. They will be completed before sign-in is switched on.",
  ],
  updated: UPDATED,
  sections: [
    {
      id: "use",
      title: "Using Vecto",
      body: [
        "Vecto is free to use as it is offered today. You may analyse any file you have the right to use.",
      ],
    },
    {
      id: "data",
      title: "Your data",
      body: [
        "Your file stays in your browser (see Privacy). You are responsible for what you choose to send through the optional AI review.",
      ],
    },
    {
      id: "warranty",
      title: "No warranty",
      body: [
        "Reports are computed automatically and can be wrong or incomplete; AI suggestions especially. They are not professional advice. Check anything you rely on before acting on it.",
      ],
    },
    {
      id: "liability",
      title: "Liability",
      body: [
        "To the extent the law allows, Vecto is provided without any warranty and without liability for losses arising from its use.",
      ],
    },
    {
      id: "changes",
      title: "Changes",
      body: [
        "These terms will change, first when accounts are introduced. The date above shows the latest version.",
      ],
    },
  ],
};
