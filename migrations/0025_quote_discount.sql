-- Quote discount + footnote under the pricing summary
ALTER TABLE quotes ADD COLUMN discount_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE quotes ADD COLUMN discount_label TEXT NOT NULL DEFAULT '';
ALTER TABLE quotes ADD COLUMN discount_note TEXT NOT NULL DEFAULT '';
