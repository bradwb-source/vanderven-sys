-- Display name for outbound CRM email (From: Name <login@vanderven.ca>).
ALTER TABLE users ADD COLUMN send_as_name TEXT NOT NULL DEFAULT '';
