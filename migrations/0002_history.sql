-- History (v1): two counts per analysis, so a signed-in user can see what they
-- have run. Applied with
--   npx wrangler d1 execute vecto-db --local  --file=migrations/0002_history.sql
--   npx wrangler d1 execute vecto-db --remote --file=migrations/0002_history.sql
--
-- What is deliberately NOT here: the file, any cell value, the column names, the
-- filename and the target column. The row and column counts are two integers that
-- identify nothing; a filename or a schema would be a real change to what Vecto
-- retains about a person's data, and that needs an explicit opt-in rather than
-- being slipped in behind a convenience feature.
--
-- Both are nullable and neither is sent by the client for this purpose: they are
-- read out of the review payload the Worker already receives (see worker/index.js),
-- so History added no new field to any request.

ALTER TABLE analyses ADD COLUMN rows INTEGER;
ALTER TABLE analyses ADD COLUMN columns INTEGER;
