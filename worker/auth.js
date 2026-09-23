/* GitHub OAuth and server-side sessions.

   Flow (opened in a POPUP by the app, never a full-page redirect — the parsed
   dataset and the built report live in the page's memory, and unloading the
   document would destroy both):

     GET /api/auth/github    → random `state` in a short-lived cookie, 302 to GitHub
     GET /api/auth/callback  → state matches? → code for token → GitHub profile
                               → upsert user → session cookie → a page that tells
                                 the opener and closes itself
     GET /api/auth/me        → { user, usage } or { user: null }
     POST /api/auth/logout   → delete the session row, clear the cookie
     POST /api/auth/delete   → delete the account and everything belonging to it

   The GitHub access token is used once, here, and never stored: we need the
   profile, not ongoing access. The scope requested is empty — public profile only.

   The session cookie holds a random 256-bit token; the DATABASE holds its SHA-256.
   A dump of `sessions` therefore hands nobody a working login. */

import { json, cookie, clearCookie, readCookie, randomToken, sha256Hex, allowedOrigins, originAllowed } from "./http.js";
import { usageFor } from "./usage.js";

const SESSION_COOKIE = "vecto_session";
const STATE_COOKIE   = "vecto_oauth_state";
const SESSION_DAYS   = 30;
const STATE_TTL_S    = 600;

const GITHUB_AUTHORIZE = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN     = "https://github.com/login/oauth/access_token";
const GITHUB_USER      = "https://api.github.com/user";

const configured = (env) => Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && env.DB);

/* The origin this deployment calls itself, used to build the callback URL and as
   the postMessage target. Taken from the request so dev and production need no
   separate value, but only after the origin has been checked against the list. */
const selfOrigin = (request, env) => {
  const origin = new URL(request.url).origin;
  const allowed = allowedOrigins(env);
  return allowed.includes(origin) ? origin : (allowed[0] ?? origin);
};

/* ── session ────────────────────────────────────────────────────────────── */

export async function createSession(env, userId) {
  const token = randomToken();
  const now = Date.now();
  await env.DB
    .prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256Hex(token), userId, now, now + SESSION_DAYS * 86_400_000)
    .run();
  return token;
}

/* → { id, login, avatar_url, plan } or null. Expiry is checked in SQL, so an
   expired row can never authenticate even if it is still on disk. */
export async function sessionUser(env, request) {
  if (!env.DB) return null;
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  return env.DB
    .prepare(`SELECT users.id, users.login, users.avatar_url, users.plan
              FROM sessions JOIN users ON users.id = sessions.user_id
              WHERE sessions.id = ? AND sessions.expires_at > ?`)
    .bind(await sha256Hex(token), Date.now())
    .first();
}

/* ── routes ─────────────────────────────────────────────────────────────── */

export async function startOAuth(request, env) {
  /* Shown IN the popup, so it has to be a page that closes itself — a JSON body
     here would leave the user looking at raw text in a window that never shuts. */
  if (!configured(env)) return popupPage("Sign-in is not configured on this deployment.");

  const state = randomToken();
  const url = new URL(GITHUB_AUTHORIZE);
  url.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  url.searchParams.set("redirect_uri", `${selfOrigin(request, env)}/api/auth/callback`);
  url.searchParams.set("state", state);
  // No `scope`: the public profile is all this app needs to identify a person.

  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      /* Path is the callback's own prefix so this cookie is sent nowhere else,
         and it dies in ten minutes whether or not the user finishes. */
      "Set-Cookie": cookie(STATE_COOKIE, state, STATE_TTL_S, "/api/auth"),
    },
  });
}

export async function oauthCallback(request, env) {
  if (!configured(env)) return popupPage("Sign-in is not configured on this deployment.");

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = readCookie(request, STATE_COOKIE);

  /* The whole point of `state`: without it, an attacker could hand a victim a
     callback URL carrying the ATTACKER's code and silently log the victim into
     the attacker's account. The value must match the one this browser was given. */
  if (!code || !state || !expected || state !== expected) {
    return popupPage("Sign-in could not be verified. Please try again.");
  }

  const token = await exchangeCode(env, code, `${selfOrigin(request, env)}/api/auth/callback`);
  if (!token) return popupPage("GitHub did not complete the sign-in.");

  const profile = await githubUser(token);
  if (!profile?.id) return popupPage("GitHub did not return a profile.");

  const user = await upsertUser(env, profile);
  const session = await createSession(env, user.id);

  // Housekeeping, not security: expiry is enforced in the query above.
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?")
    .bind(user.id, Date.now()).run();

  return popupPage(null, [
    clearCookie(STATE_COOKIE, "/api/auth"),
    cookie(SESSION_COOKIE, session, SESSION_DAYS * 86_400),
  ]);
}

export async function me(request, env) {
  const user = await sessionUser(env, request);
  if (!user) return json({ user: null, usage: null });
  return json({
    user:  { login: user.login, avatarUrl: user.avatar_url, plan: user.plan },
    usage: await usageFor(env, user.id),
  });
}

export async function logout(request, env) {
  if (!originAllowed(request, env)) return json({ error: "bad_origin" }, 403);
  const token = readCookie(request, SESSION_COOKIE);
  if (token && env.DB) {
    await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256Hex(token)).run();
  }
  return json({ ok: true }, 200, { "Set-Cookie": clearCookie(SESSION_COOKIE) });
}

/* Account deletion, from day one. Everything belonging to the person goes: the
   user row, their sessions and their usage history. The global `budget` counter is
   not touched — it holds no user data and unwinding it would let an account be
   deleted to free up the day's allowance for everyone else. */
export async function deleteAccount(request, env) {
  if (!originAllowed(request, env)) return json({ error: "bad_origin" }, 403);
  const user = await sessionUser(env, request);
  if (!user) return json({ error: "unauthenticated" }, 401);

  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM analyses WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id),
  ]);

  return json({ ok: true }, 200, { "Set-Cookie": clearCookie(SESSION_COOKIE) });
}

/* ── GitHub ─────────────────────────────────────────────────────────────── */

async function exchangeCode(env, code, redirectUri) {
  const res = await fetch(GITHUB_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id:     env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,   // a Worker secret; never in the bundle
      code,
      redirect_uri:  redirectUri,
    }),
  });
  const data = await res.json().catch(() => null);
  return typeof data?.access_token === "string" ? data.access_token : null;
}

async function githubUser(token) {
  const res = await fetch(GITHUB_USER, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "vecto",           // GitHub rejects API calls without one
    },
  });
  return res.ok ? res.json().catch(() => null) : null;
}

/* Deliberately minimal: the GitHub id, the login and the avatar. No email — it is
   not needed to sign anyone in, and what is never stored cannot leak or have to be
   deleted. The login and avatar are refreshed on every sign-in so a renamed
   account does not show a stale name. */
async function upsertUser(env, profile) {
  await env.DB
    .prepare(`INSERT INTO users (github_id, login, avatar_url, created_at)
              VALUES (?, ?, ?, ?)
              ON CONFLICT(github_id) DO UPDATE SET login = excluded.login, avatar_url = excluded.avatar_url`)
    .bind(profile.id, profile.login ?? "user", profile.avatar_url ?? null, Date.now())
    .run();
  return env.DB.prepare("SELECT id FROM users WHERE github_id = ?").bind(profile.id).first();
}

/* ── the page the popup ends on ─────────────────────────────────────────── */

/* Tells the opener what happened and closes. If it was not opened as a popup
   (someone pasted the URL), it falls back to sending them to the app. No user
   input is interpolated — the only variable is our own origin and a fixed
   message string, so there is nothing here to escape. */
function popupPage(error, cookies = []) {
  /* The target origin is read in the PAGE, not computed on the server. This page
     is always served from the app's own origin — the popup navigated to
     /api/auth/callback there and GitHub redirected back to it — so
     location.origin is right by construction, while a server-side guess can be
     wrong: behind the Vite dev proxy the Worker sees 127.0.0.1:8787, and an empty
     or foreign targetOrigin makes postMessage THROW, leaving the popup open
     forever with the opener still waiting. */
  const body = `<!doctype html><meta charset="utf-8"><title>Vecto</title>
<body style="background:#08090C;color:#F2F3F5;font:14px system-ui;padding:24px">
${error ? error.replace(/[<>&]/g, "") : "Signed in. You can close this window."}
<script>
  var payload = { source: "vecto-auth", ok: ${error ? "false" : "true"} };
  if (window.opener) { window.opener.postMessage(payload, window.location.origin); window.close(); }
  else { location.replace("/"); }
</script>`;

  const headers = new Headers({ "Content-Type": "text/html; charset=utf-8" });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(body, { status: 200, headers });
}
