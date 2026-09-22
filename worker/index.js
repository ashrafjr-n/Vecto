/* Vecto's Worker entry. Static files are served by the ASSETS binding without
   running this script — wrangler.jsonc's run_worker_first sends only /api/* here.

   POST /api/ai  { task, payload }  →  200 { task, model, result, retried? }
                                    →  4xx/5xx { error, message?, retried? }
   `retried: true` only when a provider failed inside a 200 and the one retry ran.

   The client names a TASK and never sends a prompt. If it could, this endpoint
   would be a general-purpose LLM proxy on the account's quota for anyone who finds
   the URL. Every prompt, schema and token limit lives in TASKS below. */

import { DOSSIER_MAX_COLUMNS } from "../src/lib/ai/dossierSchema.js";
import { LEAKAGE_SCHEMA, LEAKAGE_MAX_COLUMNS } from "../src/lib/ai/leakageSchema.js";
import { leakageMessages } from "./leakagePrompt.js";
import { REVIEW_SCHEMA } from "../src/lib/ai/reviewSchema.js";
import { reviewMessages } from "./reviewPrompt.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_BODY_CHARS = 256_000;

const validDossierPayload = (payload) =>
  Array.isArray(payload?.columns)
  && payload.columns.length > 0
  && payload.columns.length <= DOSSIER_MAX_COLUMNS
  && payload.columns.every((c) => typeof c?.name === "string")
  && Number.isFinite(payload.rows)
  && (payload.allColumnNames === undefined
      || (Array.isArray(payload.allColumnNames) && payload.allColumnNames.every((n) => typeof n === "string")));

const TASKS = {
  // Smoke test for the plumbing — key, model list, fallback, JSON parsing.
  // No feature calls it; use it to check a deploy: curl -X POST .../api/ai -d '{"task":"ping"}'
  ping: {
    maxTokens: 50,
    schema: {
      type: "object",
      properties: { ok: { type: "boolean" } },
      required: ["ok"],
      additionalProperties: false,
    },
    messages: () => [
      { role: "user", content: 'Reply with the JSON object {"ok": true} and nothing else.' },
    ],
  },

  /* Phases B+D in one request — what each column is, target suggestions, and cleaning
     rules for the values the engine's scan flagged. The payload is built by
     buildReviewPayload() and the answer checked by verifyReview() (src/lib/ai/review.js)
     before anything is shown. It replaced the separate `dossier` and `cleaning` tasks
     once it held their day-1 scores (vecto-plan.md item 16). The rules section is
     short; the column section is what grows, hence the dossier's token budget. */
  review: {
    maxTokens: 16000,
    schema: REVIEW_SCHEMA,
    validate: (payload) =>
      validDossierPayload(payload)
      && payload.columns.every((c) => c.cleaning === undefined || Array.isArray(c.cleaning)),
    messages: reviewMessages,
  },

  /* Phase C — semantic leakage and split advice, after the analysis. Built by
     buildLeakagePayload() (no cell values) and checked by verifyLeakage(), which
     evaluates every proposed formula on the rows before it is shown. The answer
     lists only flagged columns, so it stays short on a wide file. */
  leakage: {
    maxTokens: 6000,
    schema: LEAKAGE_SCHEMA,
    validate: (payload) =>
      typeof payload?.target?.name === "string"
      && Array.isArray(payload.columns)
      && payload.columns.length <= LEAKAGE_MAX_COLUMNS
      && payload.columns.every((c) => typeof c?.name === "string"),
    messages: leakageMessages,
  },
};

const json = (body, status = 200) => Response.json(body, { status });

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname !== "/api/ai") return json({ error: "not_found" }, 404);
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    return handleAi(request, env);
  },
};

async function handleAi(request, env) {
  const models = (env.AI_MODELS ?? "").split(",").map((m) => m.trim()).filter(Boolean);
  if (!env.OPENROUTER_API_KEY || models.length === 0) return json({ error: "ai_disabled" }, 503);

  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) return json({ error: "payload_too_large" }, 413);

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  // hasOwn, not `TASKS[name]`: "toString" or "__proto__" would otherwise resolve.
  const name = body?.task;
  if (typeof name !== "string" || !Object.hasOwn(TASKS, name)) return json({ error: "unknown_task" }, 400);
  const task = TASKS[name];
  if (task.validate && !task.validate(body.payload)) return json({ error: "invalid_payload" }, 400);

  const messages = task.messages(body.payload);
  /* A provider failing inside a 200 ends the request for OpenRouter, so its `models`
     fallback never runs — measured 2026-09-15: 5/18 dossier files lost this way and the
     second model answered none. Ask once more, without the model that failed when the
     reply names it. One retry, not a loop over models; further fallback stays with OpenRouter. */
  /* `retried` goes into the response, success or failure (vecto-plan item 43): the path
     had never run on a real overload, so every reply that used it is the evidence. */
  let retried = false;
  const ask = async (msgs) => {
    const first = await complete(env.OPENROUTER_API_KEY, models, name, task, msgs);
    if (first.unavailable === undefined) return first;
    retried = true;
    const rest = models.filter((m) => m !== first.unavailable);
    return complete(env.OPENROUTER_API_KEY, rest.length ? rest : models, name, task, msgs);
  };
  const failed = async (res) => (retried ? json({ ...(await res.json()), retried }, res.status) : res);

  let reply = await ask(messages);
  if (reply.error) return failed(reply.error);

  // A 200 carrying invalid JSON is not an error to OpenRouter, so its fallback never
  // fires. Ask once more with the parse error.
  let parsed = parseJson(reply.content);
  if (parsed.error) {
    reply = await ask([
      ...messages,
      { role: "assistant", content: reply.content },
      { role: "user", content: `That was not valid JSON (${parsed.error}). Reply with only the JSON object.` },
    ]);
    if (reply.error) return failed(reply.error);
    parsed = parseJson(reply.content);
    if (parsed.error) return json({ error: "invalid_json", message: parsed.error, ...(retried && { retried }) }, 502);
  }

  return json({ task: name, model: reply.model, result: parsed.value, ...(retried && { retried }) });
}

async function complete(apiKey, models, name, task, messages) {
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      models,
      messages,
      temperature: 0,
      max_tokens: task.maxTokens,
      /* Reasoning OFF. Measured 2026-09-14 on the ping task: nemotron-3-super spent
         its whole token budget thinking (finish "length", the reasoning text returned
         as content) and nemotron-3-ultra ignored the strict schema ({"ok":{ "ok": true }).
         With reasoning disabled both returned clean JSON. Models without reasoning
         ignore the flag. ponytail: global off; make it per task if the eval shows a
         task that is better with thinking. */
      reasoning: { enabled: false },
      response_format: {
        type: "json_schema",
        json_schema: { name, strict: true, schema: task.schema },
      },
    }),
  });
  const data = await res.json().catch(() => null);
  const message = data?.error?.message;

  // 429 after the whole `models` list: every model is rate-limited, or the
  // account's daily free quota is spent. The report must still render without AI.
  if (res.status === 429) return { error: json({ error: "rate_limited", message }, 429) };
  if (!res.ok) return { error: json({ error: "upstream_error", status: res.status, message }, 502) };

  /* A provider can fail AFTER OpenRouter has answered 200 — measured on the eval:
     "Upstream error from Nvidia: Service temporarily overloaded" arrived as a 200
     whose body carries `error` and no content. It is an availability failure, not
     an empty answer, and saying so tells the user that trying again may work.
     `unavailable` marks it retryable for handleAi: the failed model, or null if unnamed. */
  const upstreamError = data?.error ?? data?.choices?.[0]?.error;
  if (upstreamError) {
    return {
      error: json({ error: "upstream_error", status: upstreamError.code ?? res.status, message: upstreamError.message ?? message }, 502),
      unavailable: data?.model ?? null,
    };
  }
  const choice = data?.choices?.[0];
  /* Cut off at max_tokens: the JSON is incomplete by construction, so asking the
     model to repair it would spend a second request to hit the same limit. */
  if (choice?.finish_reason === "length") {
    return { error: json({ error: "truncated", message: `answer cut off at ${task.maxTokens} tokens by ${data.model}` }, 502) };
  }
  const content = choice?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    return { error: json({ error: "empty_response", message }, 502) };
  }
  return { content, model: data.model };
}

// Models without structured-output support often wrap the object in a ```json fence.
function parseJson(content) {
  try {
    return { value: JSON.parse(content.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "")) };
  } catch (err) {
    return { error: err.message };
  }
}
