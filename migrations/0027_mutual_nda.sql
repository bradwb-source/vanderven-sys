-- Mutual NDA quote attachment (PDF).
INSERT OR IGNORE INTO quote_documents
  (id, slug, title, kind, summary, body_placeholder, attach_to_every_quote, active, sort_order, created_at, updated_at, file_path, file_name)
VALUES
  (
    'doc_mutual_nda',
    'mutual-nda',
    'Mutual NDA',
    'nda',
    'Vanderven Systems Mutual Non-Disclosure Agreement.',
    'Attached PDF: Vanderven Systems Mutual NDA.',
    0,
    1,
    5,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    '/public/docs/Vanderven-Systems-Mutual-NDA.pdf',
    'Vanderven-Systems-Mutual-NDA.pdf'
  );

UPDATE quote_documents
SET
  title = 'Mutual NDA',
  summary = 'Vanderven Systems Mutual Non-Disclosure Agreement.',
  body_placeholder = 'Attached PDF: Vanderven Systems Mutual NDA.',
  attach_to_every_quote = 0,
  active = 1,
  sort_order = 5,
  file_path = '/public/docs/Vanderven-Systems-Mutual-NDA.pdf',
  file_name = 'Vanderven-Systems-Mutual-NDA.pdf',
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 'doc_mutual_nda' OR slug = 'mutual-nda';
