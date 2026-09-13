/* The browser's only door to the AI layer: POST /api/ai (worker/index.js).

   Never throws. Every outcome — success, a Worker error code, a timeout, no
   network, a cancel — comes back as one shape, because an AI failure must never
   be able to break the page it sits on. The engine report does not depend on it. */

/* Free models are slow, and a 60-column dossier is a long answer. */
const TIMEOUT_MS = 120_000;

const MESSAGES = {
  ai_disabled:       "The AI assistant is not configured on this deployment (no API key or no model list).",
  rate_limited:      "Every free model is busy, or today's free quota is spent. Nothing else is affected — try again later.",
  upstream_error:    "The AI provider returned an error.",
  empty_response:    "The model returned an empty answer.",
  invalid_json:      "The model's answer was not valid JSON, even after one retry.",
  invalid_payload:   "The request was rejected as malformed.",
  payload_too_large: "This dataset's profile is too large to send in one request.",
};

/* → { result, model, error, detail, aborted } — `error` is a sentence for the user,
   `detail` the provider's own message when there is one. */
export async function requestAi(task, payload, signal) {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const fail = (error, detail = null) => ({ result: null, model: null, error, detail, aborted: false });

  try {
    const res = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task, payload }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    const body = await res.json().catch(() => null);
    if (res.ok && body && "result" in body) {
      return { result: body.result, model: body.model ?? null, error: null, detail: null, aborted: false };
    }
    if (!body?.error) {
      return fail(`No AI endpoint answered at /api/ai (HTTP ${res.status}). Locally, run the Worker with \`npx wrangler dev\`.`);
    }
    return fail(MESSAGES[body.error] ?? `The AI endpoint answered ${res.status} (${body.error}).`, body.message ?? null);
  } catch {
    if (signal?.aborted) return { ...fail(null), aborted: true };
    if (timeout.aborted) return fail(`The model did not answer within ${TIMEOUT_MS / 1000} seconds.`);
    return fail("Could not reach the AI endpoint.");
  }
}
