-- Append-only client notes and activity feed
CREATE TABLE IF NOT EXISTS lead_notes (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'note',
  author TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lead_notes_lead ON lead_notes(lead_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lead_activity (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lead_activity_lead ON lead_activity(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_lead ON quotes(lead_id);
CREATE INDEX IF NOT EXISTS idx_invoices_lead ON invoices(lead_id);
