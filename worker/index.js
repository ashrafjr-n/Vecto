/* Vecto's Worker entry. Static files are served by the ASSETS binding without
   running this script — wrangler.jsonc's run_worker_first sends only /api/* here.

   POST /api/ai  { task, payload }  →  200 { task, model, result }
                                    →  4xx/5xx { error, message? }

   The client names a TASK and never sends a prompt. If it could, this endpoint
   would be a general-purpose LLM proxy on the account's quota for anyone who finds
   the URL. Every prompt, schema and token limit lives in TASKS below. */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_BODY_CHARS = 256_000;

const TASKS = {
  // Smoke test for the plumbing — key, model list, fallback, JSON parsing.
  // No feature calls it; phase B adds the first real task beside it.
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

  const messages = task.messages(body.payload);
  let reply = await complete(env.OPENROUTER_API_KEY, models, name, task, messages);
  if (reply.error) return reply.error;

  // A 200 carrying invalid JSON is not an error to OpenRouter, so its fallback never
  // fires. Ask once more with the parse error; availability retries stay with OpenRouter.
  let parsed = parseJson(reply.content);
  if (parsed.error) {
    reply = await complete(env.OPENROUTER_API_KEY, models, name, task, [
      ...messages,
      { role: "assistant", content: reply.content },
      { role: "user", content: `That was not valid JSON (${parsed.error}). Reply with only the JSON object.` },
    ]);
    if (reply.error) return reply.error;
    parsed = parseJson(reply.content);
    if (parsed.error) return json({ error: "invalid_json", message: parsed.error }, 502);
  }

  return json({ task: name, model: reply.model, result: parsed.value });
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

  const content = data?.choices?.[0]?.message?.content;
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
