-- ElevenLabs post-call audio recordings (bytes live in R2; metadata here)
CREATE TABLE IF NOT EXISTS call_recordings (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL UNIQUE,
  lead_id TEXT,
  note_id TEXT,
  r2_key TEXT,
  content_type TEXT NOT NULL DEFAULT 'audio/mpeg',
  byte_size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_call_recordings_lead ON call_recordings (lead_id);
