-- Vera public chat transcripts (CRM inbox)
CREATE TABLE IF NOT EXISTS vera_chats (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  visitor_name TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  lead_id TEXT,
  page_path TEXT NOT NULL DEFAULT '',
  preview TEXT NOT NULL DEFAULT '',
  message_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vera_chats_updated ON vera_chats(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_vera_chats_lead ON vera_chats(lead_id);

CREATE TABLE IF NOT EXISTS vera_messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  role TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (chat_id) REFERENCES vera_chats(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_vera_messages_chat ON vera_messages(chat_id, created_at);
