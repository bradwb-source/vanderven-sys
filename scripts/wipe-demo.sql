-- Remove demo/fake CRM customers and related rows (keep users + quote document templates).
DELETE FROM lead_notes WHERE lead_id LIKE '%_demo_%';
DELETE FROM lead_activity WHERE lead_id LIKE '%_demo_%';
DELETE FROM quote_document_links WHERE quote_id LIKE '%_demo_%';
DELETE FROM reminder_log WHERE quote_id LIKE '%_demo_%';
DELETE FROM jobs WHERE id LIKE '%_demo_%' OR lead_id LIKE '%_demo_%';
DELETE FROM quotes WHERE id LIKE '%_demo_%' OR lead_id LIKE '%_demo_%';
DELETE FROM invoices WHERE id LIKE '%_demo_%' OR lead_id LIKE '%_demo_%';
DELETE FROM leads WHERE id LIKE '%_demo_%' OR source = 'demo';
