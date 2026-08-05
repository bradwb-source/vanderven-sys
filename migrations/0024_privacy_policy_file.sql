-- Attach real Privacy & Confidentiality Commitment Word file to Privacy Policy quote document.
UPDATE quote_documents
SET
  title = 'Privacy Policy',
  summary = 'Vanderven Systems Privacy & Confidentiality Commitment.',
  body_placeholder = 'Attached Word document: Vanderven Systems Privacy & Confidentiality Commitment.',
  attach_to_every_quote = 1,
  active = 1,
  file_path = '/public/docs/Vanderven-Systems-Privacy-Confidentiality-Commitment.docx',
  file_name = 'Vanderven-Systems-Privacy-Confidentiality-Commitment.docx',
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 'doc_privacy';
