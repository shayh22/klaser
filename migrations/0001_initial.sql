-- Credit accounting only. There is deliberately no table a document could be
-- written to: the image lives in worker memory for the length of one request and
-- is never persisted anywhere.

CREATE TABLE IF NOT EXISTS tokens (
  token        TEXT PRIMARY KEY,
  used         INTEGER NOT NULL DEFAULT 0,
  credit_limit INTEGER NOT NULL,
  resets_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS spend (
  day TEXT PRIMARY KEY,
  usd REAL NOT NULL DEFAULT 0
);
