-- Track first time a client opens the public quote sign link.
ALTER TABLE quotes ADD COLUMN client_viewed_at TEXT;
