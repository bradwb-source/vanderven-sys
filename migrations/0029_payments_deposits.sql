-- Public pay links + client deposits (card / e-transfer / manual)
ALTER TABLE quotes ADD COLUMN pay_token TEXT;
ALTER TABLE quotes ADD COLUMN pay_token_created_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_quotes_pay_token ON quotes(pay_token);

ALTER TABLE invoices ADD COLUMN pay_token TEXT;
ALTER TABLE invoices ADD COLUMN pay_token_created_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_pay_token ON invoices(pay_token);

CREATE TABLE IF NOT EXISTS client_deposits (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  quote_id TEXT,
  invoice_id TEXT,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  fee_cents INTEGER NOT NULL DEFAULT 0,
  method TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'pending',
  stripe_session_id TEXT,
  stripe_payment_intent TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE SET NULL,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_client_deposits_lead ON client_deposits(lead_id);
CREATE INDEX IF NOT EXISTS idx_client_deposits_status ON client_deposits(status);
CREATE INDEX IF NOT EXISTS idx_client_deposits_quote ON client_deposits(quote_id);
CREATE INDEX IF NOT EXISTS idx_client_deposits_invoice ON client_deposits(invoice_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_client_deposits_stripe_session ON client_deposits(stripe_session_id)
  WHERE stripe_session_id IS NOT NULL AND stripe_session_id != '';
