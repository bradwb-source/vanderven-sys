-- Quote attachment library (privacy, terms, forms) + per-quote links
CREATE TABLE IF NOT EXISTS quote_documents (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other',
  summary TEXT NOT NULL DEFAULT '',
  body_placeholder TEXT NOT NULL DEFAULT '',
  attach_to_every_quote INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quote_document_links (
  quote_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  PRIMARY KEY (quote_id, document_id),
  FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES quote_documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_quote_documents_every ON quote_documents(attach_to_every_quote);
CREATE INDEX IF NOT EXISTS idx_quote_document_links_quote ON quote_document_links(quote_id);
