/* The plan-and-explainer contract (AI phase E), shared by the Worker and the
   browser. Pure data.

   The model adds no facts. It ORDERS the engine's recommendations into steps that
   reference them by id, and explains the report in plain language — and every
   number it writes must already be in the report (see verifyPlan). */

export const PLAN_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title:             { type: "string" },
          why:               { type: "string" },
          recommendationIds: { type: "array", items: { type: "string" } },
        },
        required: ["title", "why", "recommendationIds"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "steps"],
  additionalProperties: false,
};

export const PLAN_SUMMARY_MAX_WORDS = 150;
