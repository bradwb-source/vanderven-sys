-- Real file attachments for quote documents + Client Services Agreement default.
ALTER TABLE quote_documents ADD COLUMN file_path TEXT NOT NULL DEFAULT '';
ALTER TABLE quote_documents ADD COLUMN file_name TEXT NOT NULL DEFAULT '';

INSERT OR IGNORE INTO quote_documents
  (id, slug, title, kind, summary, body_placeholder, attach_to_every_quote, active, sort_order, created_at, updated_at, file_path, file_name)
VALUES
  (
    'doc_client_services',
    'client-services-agreement',
    'Client Services Agreement',
    'agreement',
    'Vanderven Systems Client Services Agreement (2026).',
    'Attached Word document: Vanderven Systems Client Services Agreement 2026.',
    1,
    1,
    4,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    '/public/docs/Vanderven-Systems-Client-Services-Agreement-2026.docx',
    'Vanderven-Systems-Client-Services-Agreement-2026.docx'
  );

UPDATE quote_documents
SET
  title = 'Client Services Agreement',
  summary = 'Vanderven Systems Client Services Agreement (2026).',
  body_placeholder = 'Attached Word document: Vanderven Systems Client Services Agreement 2026.',
  attach_to_every_quote = 1,
  active = 1,
  file_path = '/public/docs/Vanderven-Systems-Client-Services-Agreement-2026.docx',
  file_name = 'Vanderven-Systems-Client-Services-Agreement-2026.docx',
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 'doc_client_services';
