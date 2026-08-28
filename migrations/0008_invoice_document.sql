-- Invoice document fields (bill-to, line items, tax, send)
ALTER TABLE invoices ADD COLUMN quote_id TEXT;
ALTER TABLE invoices ADD COLUMN bill_to_name TEXT NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN bill_to_email TEXT NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN bill_to_phone TEXT NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN bill_to_address TEXT NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN issue_date TEXT;
ALTER TABLE invoices ADD COLUMN tax_rate REAL NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN line_items_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE invoices ADD COLUMN payment_terms TEXT NOT NULL DEFAULT 'Net 15';
ALTER TABLE invoices ADD COLUMN sent_at TEXT;

CREATE INDEX IF NOT EXISTS idx_invoices_quote ON invoices(quote_id);
CREATE INDEX IF NOT EXISTS idx_invoices_lead ON invoices(lead_id);
