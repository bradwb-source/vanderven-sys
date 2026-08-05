-- Allow authors to edit their own notes
ALTER TABLE lead_notes ADD COLUMN author_user_id TEXT NOT NULL DEFAULT '';
ALTER TABLE lead_notes ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';

UPDATE lead_notes SET updated_at = created_at WHERE TRIM(updated_at) = '';
