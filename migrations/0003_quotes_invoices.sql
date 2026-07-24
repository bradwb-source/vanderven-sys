CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  lead_id TEXT,
  number TEXT NOT NULL,
  title TEXT NOT NULL,
  client_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  amount_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
CREATE INDEX IF NOT EXISTS idx_quotes_updated ON quotes(updated_at DESC);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  lead_id TEXT,
  job_id TEXT,
  number TEXT NOT NULL,
  title TEXT NOT NULL,
  client_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  amount_cents INTEGER NOT NULL DEFAULT 0,
  due_date TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_due ON invoices(due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_updated ON invoices(updated_at DESC);
