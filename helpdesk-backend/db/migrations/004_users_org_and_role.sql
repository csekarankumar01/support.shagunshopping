BEGIN;

-- Email is now unique per organisation, not globally (replaces migration 002's rule).
ALTER TABLE users DROP CONSTRAINT users_email_key;

ALTER TABLE users
    ADD COLUMN org_id    UUID    NOT NULL REFERENCES organizations (id),
    ADD COLUMN role      TEXT    NOT NULL CHECK (role IN ('ADMIN', 'AGENT', 'CUSTOMER')),
    ADD COLUMN is_online BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE users ADD CONSTRAINT users_org_email_key UNIQUE (org_id, email);

COMMIT;
