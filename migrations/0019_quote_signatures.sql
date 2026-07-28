-- Client e-signature for quote approval
ALTER TABLE quotes ADD COLUMN sign_token TEXT;
ALTER TABLE quotes ADD COLUMN sign_token_created_at TEXT;
ALTER TABLE quotes ADD COLUMN signed_at TEXT;
ALTER TABLE quotes ADD COLUMN signed_name TEXT;
ALTER TABLE quotes ADD COLUMN signature_png TEXT;
ALTER TABLE quotes ADD COLUMN signed_ip TEXT;
ALTER TABLE quotes ADD COLUMN signed_user_agent TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_quotes_sign_token ON quotes(sign_token);
