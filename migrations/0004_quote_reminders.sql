-- Track when a quote was marked sent (reminder cadence starts here).
ALTER TABLE quotes ADD COLUMN sent_at TEXT;
ALTER TABLE quotes ADD COLUMN owner_email TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS reminder_settings (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL DEFAULT '',
  owner_enabled INTEGER NOT NULL DEFAULT 1,
  owner_days TEXT NOT NULL DEFAULT '2,5,10',
  client_enabled INTEGER NOT NULL DEFAULT 1,
  client_days TEXT NOT NULL DEFAULT '3,7,14',
  stop_on_closed INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reminder_log (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL,
  audience TEXT NOT NULL,
  day_offset INTEGER NOT NULL,
  to_email TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT 'log',
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (quote_id, audience, day_offset),
  FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reminder_log_created ON reminder_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reminder_log_quote ON reminder_log(quote_id);
CREATE INDEX IF NOT EXISTS idx_quotes_sent_at ON quotes(sent_at);
