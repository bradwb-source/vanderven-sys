-- Replace Client Services Agreement Word attachment with PDF.
UPDATE quote_documents
SET
  summary = 'Vanderven Systems Client Services Agreement.',
  body_placeholder = 'Attached PDF: Vanderven Systems Client Services Agreement.',
  file_path = '/public/docs/Vanderven-Systems-Client-Services-Agreement.pdf',
  file_name = 'Vanderven-Systems-Client-Services-Agreement.pdf',
  updated_at = datetime('now')
WHERE id = 'doc_client_services' OR slug = 'client-services-agreement';
