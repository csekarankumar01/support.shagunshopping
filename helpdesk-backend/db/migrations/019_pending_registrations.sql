-- Email verification at sign-up. Registering an organisation no longer creates it straight away: the request is parked
-- here with a 6-digit code emailed to the admin, and the organisation and its first admin are created only when that
-- code is entered. So nobody can register an organisation (or hold a name) with an address they do not own, and
-- unverified sign-ups never become tenants, so there is nothing to clean up.
--
-- Not tenant data (there is no organisation yet), so no org_id and no Row-Level Security. It holds only a bcrypt
-- password hash and a keyed hash of the code, never the code itself. Rows expire after 10 minutes.
CREATE TABLE pending_registrations (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_slug      TEXT NOT NULL UNIQUE,
    org_name      TEXT NOT NULL,
    email         TEXT NOT NULL CHECK (email = lower(email)),
    password_hash TEXT NOT NULL,
    code_hash     TEXT NOT NULL,
    attempts      INT NOT NULL DEFAULT 0,
    sends         INT NOT NULL DEFAULT 1,
    last_sent_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX pending_registrations_expires_idx ON pending_registrations (expires_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON pending_registrations TO helpdesk_app;

COMMENT ON TABLE  pending_registrations              IS 'Sign-ups waiting for their email code. Expire after 10 minutes; the organisation is created only after verification.';
COMMENT ON COLUMN pending_registrations.code_hash    IS 'Keyed hash of the 6-digit code (never the code).';
COMMENT ON COLUMN pending_registrations.attempts     IS 'Wrong codes so far; at 5 the sign-up is thrown away.';
COMMENT ON COLUMN pending_registrations.sends        IS 'How many codes were emailed for this sign-up (capped at 5).';

-- Registration has to say early that a name is taken, but it runs before any tenant context exists, so Row-Level
-- Security hides every organisation from it. This narrow function answers one yes/no question and nothing else
-- (the same fact a duplicate registration already reveals).
CREATE FUNCTION org_slug_taken(p_slug TEXT) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM organizations WHERE slug = p_slug)
$$;
REVOKE ALL ON FUNCTION org_slug_taken(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION org_slug_taken(TEXT) TO helpdesk_app;
