-- Quote deposit due at kickoff (defaults to 50% of investment total when null).
ALTER TABLE quotes ADD COLUMN deposit_cents INTEGER;
