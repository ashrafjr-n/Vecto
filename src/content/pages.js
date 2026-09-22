/* Copy for the plain reading pages (/about, /privacy, /terms), rendered by
   pages/TextPage.jsx. Each section is { id, title, body: [paragraph | { list }] }.

   /privacy states facts about the running app — what each AI task sends, the
   answer cache, analytics, hosting. If one of those changes (a new AI task, a new
   payload field, a new third-party script), this copy is wrong until it changes
   too; nothing links the two. */

const UPDATED = "22 September 2026";
const GITHUB = "https://github.com/ashrafjr-n/vecto";

export const ABOUT = {
  title: "About Vecto",
  lead: [
    "Vecto is a dataset analyzer for people preparing data for machine learning. Drop a CSV and it reports what the data can and cannot support — before anything is trained on it.",
  ],
  sections: [
    {
      id: "what",
      title: "What it does",
      body: [
        "It reads what each column is from its values, measures quality, statistics and relationships, checks every column against the target — including for leakage — and turns the result into prioritised advice, a preparation plan and a scikit-learn script that repeats it.",
        "Every figure comes with its reasoning: a coefficient with its p-value and sample size, a capped score with what capped it, a column that could not be measured named as such.",
      ],
    },
    {
      id: "how",
      title: "How it is built",
      body: [
        "The analysis is a deterministic JavaScript engine that runs in your browser tab. Its statistics are checked against pandas and scipy, and every rule was tested on more than 40 public datasets before it shipped.",
        "An optional AI review sits on top of the engine as the last layer. It suggests what columns mean and which ones may leak the target; every claim is checked against the file, labelled as AI, and changes the report only when you accept it.",
      ],
    },
    {
      id: "not",
      title: "What it is not",
      body: [
        "It does not train or tune models — the one baseline model in the report is a measurement, not a result to use. It does not store your data: there is no server that receives files.",
      ],
    },
    {
      id: "source",
      title: "Source and contact",
      body: [
        { link: GITHUB, text: "The source code is on GitHub. Questions, bugs and suggestions are welcome as issues there." },
      ],
    },
  ],
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
