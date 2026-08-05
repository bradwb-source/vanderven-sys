-- Quote line items, inline terms, and addendums on the letterhead
ALTER TABLE quotes ADD COLUMN line_items_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE quotes ADD COLUMN terms TEXT NOT NULL DEFAULT '';
ALTER TABLE quotes ADD COLUMN addendums TEXT NOT NULL DEFAULT '';
