-- Cached address → lat/lng for schedule map pins
CREATE TABLE IF NOT EXISTS geocode_cache (
  query_key TEXT PRIMARY KEY,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
