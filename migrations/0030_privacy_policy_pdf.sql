-- Replace Privacy Policy Word attachment with PDF.
UPDATE quote_documents
SET
  title = 'Privacy Policy',
  summary = 'Vanderven Systems Privacy Policy.',
  body_placeholder = 'Attached PDF: Vanderven Systems Privacy Policy.',
  attach_to_every_quote = 1,
  active = 1,
  file_path = '/public/docs/Vanderven-Systems-Privacy-Policy.pdf',
  file_name = 'Vanderven-Systems-Privacy-Policy.pdf',
  updated_at = datetime('now')
WHERE id = 'doc_privacy' OR slug = 'privacy-policy';
