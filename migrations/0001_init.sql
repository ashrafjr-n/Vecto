-- Vecto: accounts, sessions and free-tier AI usage. Applied with
--   npx wrangler d1 execute vecto-db --local  --file=migrations/0001_init.sql
--   npx wrangler d1 execute vecto-db --remote --file=migrations/0001_init.sql
--
-- Four tables, no more. There is deliberately NO `usage` counter table: a month's
-- usage is COUNT(*) over `analyses` for that period, so there is no second number
-- that can drift out of step with the first.

CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  github_id   INTEGER NOT NULL UNIQUE,
  login       TEXT    NOT NULL,
  avatar_url  TEXT,
  created_at  INTEGER NOT NULL,
  -- The only hook left for a paid tier later. Nothing reads it yet beyond the
  -- free limit lookup; billing is explicitly out of scope (vecto-plan).
  plan        TEXT    NOT NULL DEFAULT 'free'
);

-- `id` is the SHA-256 of the cookie value, never the value itself: a dump of this
-- table must not hand anyone a working session.
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT    PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

-- One row per analysis (one dataset/report), whatever number of AI requests it
-- needed. `period` is 'YYYY-MM' in UTC — the monthly reset is this key changing,
-- not a scheduled job, so there is nothing to run at midnight on the 1st.
CREATE TABLE IF NOT EXISTS analyses (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  analysis_id TEXT    NOT NULL,
  period      TEXT    NOT NULL,
  requests    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, analysis_id)
);

CREATE INDEX IF NOT EXISTS analyses_period ON analyses(user_id, period);

-- Every AI request that reached the provider, all users together, per UTC day.
-- This is what bounds the upstream account quota; per-user limits do not, because
-- accounts are free to create.
CREATE TABLE IF NOT EXISTS budget (
  day       TEXT    PRIMARY KEY,
  requests  INTEGER NOT NULL DEFAULT 0
);
