CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  lead_id TEXT,
  title TEXT NOT NULL,
  client_name TEXT NOT NULL DEFAULT '',
  assignee TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'unscheduled',
  scheduled_date TEXT,
  start_time TEXT,
  duration_min INTEGER NOT NULL DEFAULT 90,
  notes TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT 'slate',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_date ON jobs(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_assignee ON jobs(assignee);
CREATE INDEX IF NOT EXISTS idx_jobs_lead ON jobs(lead_id);
