CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  active INTEGER NOT NULL DEFAULT 1,
  owner_enabled INTEGER NOT NULL DEFAULT 1,
  owner_days TEXT NOT NULL DEFAULT '2,5,10',
  client_enabled INTEGER NOT NULL DEFAULT 1,
  client_days TEXT NOT NULL DEFAULT '3,7,14',
  stop_on_closed INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(active);
