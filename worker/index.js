/* Vecto's Worker entry. Static files are served by the ASSETS binding without
   running this script — wrangler.jsonc's run_worker_first sends only /api/* here.

   POST /api/ai  { task, payload, analysisId }  →  200 { task, model, result, usage?, retried? }
                                                →  4xx/5xx { error, message?, retried? }
   `retried: true` only when a provider failed inside a 200 and the one retry ran.

   GET  /api/auth/github    GET /api/auth/callback   GET  /api/auth/me
   POST /api/auth/logout    POST /api/auth/delete                  (worker/auth.js)

   The client names a TASK and never sends a prompt. If it could, this endpoint
   would be a general-purpose LLM proxy on the account's quota for anyone who finds
   the URL. Every prompt, schema and token limit lives in TASKS below.

   The LOCAL analysis needs none of this: the engine runs in the browser and the
   report, the preparation plan and the script export never touch the Worker. Only
   the AI layer is behind a session. */

import { DOSSIER_MAX_COLUMNS } from "../src/lib/ai/dossierSchema.js";
import { LEAKAGE_SCHEMA, LEAKAGE_MAX_COLUMNS } from "../src/lib/ai/leakageSchema.js";
import { leakageMessages } from "./leakagePrompt.js";
import { REVIEW_SCHEMA } from "../src/lib/ai/reviewSchema.js";
import { reviewMessages } from "./reviewPrompt.js";
import { json, originAllowed } from "./http.js";
import * as auth from "./auth.js";
import { checkQuota, recordUsage, recordBudget, budgetAvailable, usageFor, validAnalysisId, historyFor } from "./usage.js";

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

const ROUTES = {
  "GET /api/auth/github":   auth.startOAuth,
  "GET /api/auth/callback": auth.oauthCallback,
  "GET /api/auth/me":       auth.me,
  "GET /api/history":       history,
  "POST /api/auth/logout":  auth.logout,
  "POST /api/auth/delete":  auth.deleteAccount,
  "POST /api/ai":           handleAi,
};

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    // hasOwn for the same reason TASKS uses it: "constructor" must not resolve.
    const key = `${request.method} ${pathname}`;
    if (Object.hasOwn(ROUTES, key)) return ROUTES[key](request, env);
    // A known path with the wrong verb is 405, an unknown path is 404.
    const known = Object.keys(ROUTES).some((r) => r.endsWith(` ${pathname}`));
    return json({ error: known ? "method_not_allowed" : "not_found" }, known ? 405 : 404);
  },
};

/* The eval harness (tools/ai-eval.mjs) and the Worker tests drive this endpoint
   directly, with no browser, no cookie and no Origin header. They present
   EVAL_TOKEN instead, which is a Worker SECRET read from env — it is never
   imported by anything under src/, so it cannot reach the client bundle.
   Eval traffic skips the session, the origin check and the per-user quota, but
   still records into the global budget so that counter matches reality. */
const isEvalRequest = (request, env) =>
  Boolean(env.EVAL_TOKEN) && request.headers.get("Authorization") === `Bearer ${env.EVAL_TOKEN}`;

/* The signed-in user's own analyses. A GET that returns only this account's rows:
   no Origin check, exactly like /api/auth/me — a cross-site page cannot read the
   response without CORS headers, which this endpoint does not send. */
async function history(request, env) {
  const user = await auth.sessionUser(env, request);
  if (!user) return json({ error: "unauthenticated" }, 401);
  return json({ analyses: await historyFor(env, user.id) });
}

/* What History records, taken from the payload the request already carried rather
   than from anything new the client sends. The review payload states the file's
   row count and, on a split part, the full column list; the leakage payload has
   no row count, so a leakage-only analysis stores nulls and History shows a dash. */
function datasetMeta(name, payload) {
  if (name !== "review") return {};
  return {
    rows:    Number.isFinite(payload?.rows) ? payload.rows : null,
    columns: payload?.allColumnNames?.length ?? payload?.columns?.length ?? null,
  };
}

async function handleAi(request, env) {
  const models = (env.AI_MODELS ?? "").split(",").map((m) => m.trim()).filter(Boolean);
  if (!env.OPENROUTER_API_KEY || models.length === 0) return json({ error: "ai_disabled" }, 503);

  /* Order matters: the eval bypass is checked before the origin, because a Node
     client sends no Origin at all and would otherwise be rejected here. */
  const fromEval = isEvalRequest(request, env);
  let user = null;

  if (!fromEval) {
    if (!originAllowed(request, env)) return json({ error: "bad_origin" }, 403);

    user = await auth.sessionUser(env, request);
    if (!user) return json({ error: "unauthenticated" }, 401);

    /* The global guard, before the per-user one: the upstream account quota is
       shared by everyone, so this is the limit that actually bounds the bill. */
    if (!(await budgetAvailable(env))) return json({ error: "budget_exhausted" }, 503);
  }

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

  /* One analysis id per dataset. Every request carrying an id this user has
     already paid for is free (up to a ceiling no real file reaches), so a wide
     file sent in six parts still costs one of the three monthly analyses. */
  const analysisId = body?.analysisId;
  if (!fromEval) {
    if (!validAnalysisId(analysisId)) return json({ error: "invalid_analysis_id" }, 400);
    const allowed = await checkQuota(env, user.id, analysisId);
    if (!allowed.ok) {
      return json({ error: allowed.error, usage: await usageFor(env, user.id) }, allowed.status);
    }
  }

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

  /* Charged only here, on a successful answer. A provider failure costs nothing
     upstream and must never cost a user one of their three analyses. */
  let usage;
  if (env.DB) {
    if (fromEval) await recordBudget(env);
    else {
      await recordUsage(env, user.id, analysisId, datasetMeta(name, body.payload));
      usage = await usageFor(env, user.id);
    }
  }

  return json({
    task: name,
    model: reply.model,
    result: parsed.value,
    ...(usage && { usage }),        // lets the page update its counter without a second call
    ...(retried && { retried }),
  });
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
