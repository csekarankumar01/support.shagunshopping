-- Emails are now trimmed and lowercased by the API before they are stored or looked up, so "Ann@x.com" and
-- "ann@x.com" are one account. Bring existing rows in line (skipping any that would collide with an address that
-- is already lowercase), then forbid mixed-case addresses from now on. NOT VALID keeps the migration from failing
-- on a leftover collision while still checking every new or changed row.
UPDATE users u
   SET email = lower(u.email)
 WHERE u.email <> lower(u.email)
   AND NOT EXISTS (
       SELECT 1 FROM users o WHERE o.org_id = u.org_id AND o.email = lower(u.email) AND o.id <> u.id
   );

ALTER TABLE users ADD CONSTRAINT users_email_lowercase CHECK (email = lower(email)) NOT VALID;
