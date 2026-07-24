-- Per-client company logo (URL or data URL)
ALTER TABLE leads ADD COLUMN logo_url TEXT NOT NULL DEFAULT '';
