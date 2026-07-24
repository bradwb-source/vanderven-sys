-- Account owner: protected admin that cannot be demoted/deactivated.
ALTER TABLE users ADD COLUMN is_owner INTEGER NOT NULL DEFAULT 0;
