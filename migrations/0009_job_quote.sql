-- Link builds back to the quote they came from
ALTER TABLE jobs ADD COLUMN quote_id TEXT;
CREATE INDEX IF NOT EXISTS idx_jobs_quote ON jobs(quote_id);
