/* Small HTTP helpers shared by the Worker's routes: JSON replies, cookie reading
   and writing, and the origin check. Nothing here talks to the database. */

export const json = (body, status = 200, headers = {}) =>
  Response.json(body, { status, headers });

/* One cookie out of a request's Cookie header, or null. No library: the header is
   `a=1; b=2` and the values we set are base64url or hex, so there is nothing to
   decode and nothing that can contain a separator. */
export function readCookie(request, name) {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim() || null;
  }
  return null;
}

/* HttpOnly so no script can read it (an XSS then cannot steal the session),
   Secure so it never travels over plain http — browsers treat localhost as a
   secure context, so this works in dev too — and SameSite=Lax so a cross-site
   POST carries no cookie while the OAuth callback, a top-level GET navigation,
   still does. Max-Age 0 with an empty value is how a cookie is deleted. */
export function cookie(name, value, maxAgeSeconds, path = "/") {
  const parts = [
    `${name}=${value}`,
    `Path=${path}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  return parts.join("; ");
}

export const clearCookie = (name, path = "/") => cookie(name, "", 0, path);

/* Origins this deployment answers to, from the ALLOWED_ORIGINS var:
   "https://vecto.example.workers.dev" in production, plus the Vite dev origin in
   .dev.vars. Empty means "not configured", and the check then fails closed. */
export const allowedOrigins = (env) =>
  (env.ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);

/* A browser always sends Origin on a cross-origin request and on any POST, so a
   state-changing route can require it. This is the CSRF guard that sits beside
   SameSite=Lax: a form posted from another site would arrive with a foreign
   Origin, and a fetch from another site would not carry the cookie at all. */
export function originAllowed(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  return allowedOrigins(env).includes(origin);
}

/* Random, URL-safe, 256 bits. Used for session tokens and the OAuth `state`.
   crypto.getRandomValues is the platform CSPRNG — never Math.random for either. */
export function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
