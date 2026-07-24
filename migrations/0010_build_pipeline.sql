-- Remap build stages to the creative pipeline
UPDATE jobs SET status = 'rough_draft' WHERE status IN ('scheduled', 'discovery');
UPDATE jobs SET status = 'architecture' WHERE status = 'build';
UPDATE jobs SET status = 'client_approval' WHERE status = 'review';
