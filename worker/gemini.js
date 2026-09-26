/* Google's Gemini API — the primary provider since 2026-09-26, with OpenRouter behind
   it (worker/index.js). Native generateContent rather than Google's OpenAI-compatible
   endpoint: the native API takes the task's JSON Schema as it is written
   (`responseJsonSchema`), including the ["string", "null"] types the schemas use.

   Answers in the SAME shape as the OpenRouter call in index.js — { content, model } or
   { error: Response } — so handleAi's JSON parsing, repair round and usage accounting
   never need to know which provider answered. */

import { json } from "./http.js";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";

/* One attempt's wall-clock limit. Flash-Lite answers in seconds; a request still open
   after this is stuck, and the fallback needs the rest of the page's 180 s budget
   (requestAi.js) — OpenRouter's free model takes 70-95 s on its own. */
export const GEMINI_TIMEOUT_MS = 75_000;

/* OpenAI-style messages → Gemini's systemInstruction + contents. The prompts are one
   system message and user turns, plus an assistant turn in the JSON repair round. */
export function toGeminiRequest(messages, task, { schema = true } = {}) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  return {
    ...(system && { systemInstruction: { parts: [{ text: system }] } }),
    contents: messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
    generationConfig: {
      temperature: 0,
      maxOutputTokens: task.maxTokens,
      responseMimeType: "application/json",
      ...(schema && { responseJsonSchema: task.schema }),
    },
  };
}

async function call(apiKey, model, body) {
  try {
    const res = await fetch(`${GEMINI_URL}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    });
    return { res, data: await res.json().catch(() => null) };
  } catch (err) {
    return { failed: err?.name === "TimeoutError" ? `no answer within ${GEMINI_TIMEOUT_MS / 1000} s` : String(err?.message ?? err) };
  }
}

/* → { content, model } | { error: Response }. */
export async function completeGemini(apiKey, model, task, messages) {
  let { res, data, failed } = await call(apiKey, model, toGeminiRequest(messages, task));
  if (failed) return { error: json({ error: "upstream_error", message: failed }, 502) };

  /* A 400 on the schema itself (a keyword this model's schema support does not take)
     must not cost the answer: ask once more for plain JSON. The prompt already states
     the shape, and every answer is checked by the task's verifier in the browser. */
  if (res.status === 400 && /schema/i.test(data?.error?.message ?? "")) {
    console.warn(`gemini ${model}: schema refused, retrying as plain JSON — ${data.error.message}`);
    ({ res, data, failed } = await call(apiKey, model, toGeminiRequest(messages, task, { schema: false })));
    if (failed) return { error: json({ error: "upstream_error", message: failed }, 502) };
  }

  const message = data?.error?.message;
  if (res.status === 429) return { error: json({ error: "rate_limited", message }, 429) };
  if (!res.ok) return { error: json({ error: "upstream_error", status: res.status, message }, 502) };

  const candidate = data?.candidates?.[0];
  const answeredBy = data?.modelVersion ?? model;
  if (candidate?.finishReason === "MAX_TOKENS") {
    return { error: json({ error: "truncated", message: `answer cut off at ${task.maxTokens} tokens by ${answeredBy}` }, 502) };
  }
  const content = (candidate?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  if (!content.trim()) {
    const reason = data?.promptFeedback?.blockReason ?? candidate?.finishReason ?? null;
    return { error: json({ error: "empty_response", message: reason ? `no content (${reason})` : message }, 502) };
  }
  return { content, model: answeredBy };
}
