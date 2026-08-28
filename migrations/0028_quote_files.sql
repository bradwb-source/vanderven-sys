-- Extra files attached to a specific quote (drag-and-drop uploads).
CREATE TABLE IF NOT EXISTS quote_files (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  byte_size INTEGER NOT NULL DEFAULT 0,
  r2_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_quote_files_quote ON quote_files(quote_id);
