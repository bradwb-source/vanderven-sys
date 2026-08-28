-- Client site / mailing address (for Google Maps)
ALTER TABLE leads ADD COLUMN address_line TEXT NOT NULL DEFAULT '';
ALTER TABLE leads ADD COLUMN city TEXT NOT NULL DEFAULT '';
ALTER TABLE leads ADD COLUMN region TEXT NOT NULL DEFAULT '';
ALTER TABLE leads ADD COLUMN postal_code TEXT NOT NULL DEFAULT '';
ALTER TABLE leads ADD COLUMN country TEXT NOT NULL DEFAULT 'Canada';

UPDATE leads SET
  address_line = '1840 Industrial Ave',
  city = 'Kelowna',
  region = 'BC',
  postal_code = 'V1Y 7R2',
  country = 'Canada'
WHERE id = 'lead_demo_01' AND (address_line IS NULL OR address_line = '');

UPDATE leads SET
  address_line = '312 Bernard Ave',
  city = 'Kelowna',
  region = 'BC',
  postal_code = 'V1Y 6N5',
  country = 'Canada'
WHERE id = 'lead_demo_02' AND (address_line IS NULL OR address_line = '');

UPDATE leads SET
  address_line = '245 Lakeshore Rd',
  city = 'Penticton',
  region = 'BC',
  postal_code = 'V2A 1B4',
  country = 'Canada'
WHERE id = 'lead_demo_03' AND (address_line IS NULL OR address_line = '');

UPDATE leads SET
  address_line = '901 Ellis St',
  city = 'Kelowna',
  region = 'BC',
  postal_code = 'V1Y 1Z5',
  country = 'Canada'
WHERE id = 'lead_demo_04' AND (address_line IS NULL OR address_line = '');

UPDATE leads SET
  address_line = '78 Greenway Dr',
  city = 'Vernon',
  region = 'BC',
  postal_code = 'V1T 9H2',
  country = 'Canada'
WHERE id = 'lead_demo_05' AND (address_line IS NULL OR address_line = '');
