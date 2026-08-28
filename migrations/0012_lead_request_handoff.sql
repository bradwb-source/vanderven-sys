-- Internal request handoff: who logged it (Rob) → who owns it (Brad)
ALTER TABLE leads ADD COLUMN requested_by TEXT NOT NULL DEFAULT '';
ALTER TABLE leads ADD COLUMN assignee TEXT NOT NULL DEFAULT '';

-- Open inquiries become Rob → Brad handoffs
UPDATE leads
SET requested_by = CASE WHEN TRIM(requested_by) = '' THEN 'Rob' ELSE requested_by END,
    assignee = CASE WHEN TRIM(assignee) = '' THEN 'Brad' ELSE assignee END
WHERE stage IN ('new', 'audit');
