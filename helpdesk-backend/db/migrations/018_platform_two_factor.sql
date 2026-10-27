-- Two-factor sign-in (TOTP) for platform admins. The secret is stored ENCRYPTED (AES-256-GCM, key derived from the
-- server's JWT_SECRET), so a copy of the database alone cannot produce codes. totp_last_step is the last 30-second
-- window that was accepted: a code can be used once, never replayed. Set up from the server with
-- `npm run platform:2fa -- email`.
ALTER TABLE platform_admins
    ADD COLUMN totp_secret    TEXT,
    ADD COLUMN totp_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN totp_last_step BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN platform_admins.totp_secret    IS 'Encrypted TOTP secret (never plain text).';
COMMENT ON COLUMN platform_admins.totp_enabled   IS 'true = sign-in needs a 6-digit authenticator code as well as the password.';
COMMENT ON COLUMN platform_admins.totp_last_step IS 'Last accepted 30-second window; stops a code being used twice.';

DROP FUNCTION platform_lookup_admin(TEXT);
CREATE FUNCTION platform_lookup_admin(p_email TEXT)
RETURNS TABLE (id UUID, email TEXT, password_hash TEXT, is_active BOOLEAN,
               totp_secret TEXT, totp_enabled BOOLEAN, totp_last_step BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT a.id, a.email, a.password_hash, a.is_active, a.totp_secret, a.totp_enabled, a.totp_last_step
      FROM platform_admins a WHERE a.email = p_email
$$;

-- Records a used window, but only if it is newer than the stored one (so two simultaneous logins cannot both use a code).
CREATE FUNCTION platform_use_totp_step(p_id UUID, p_step BIGINT) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    WITH moved AS (
        UPDATE platform_admins SET totp_last_step = p_step
         WHERE id = p_id AND totp_last_step < p_step RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM moved)
$$;

REVOKE ALL ON FUNCTION platform_lookup_admin(TEXT), platform_use_totp_step(UUID, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_lookup_admin(TEXT), platform_use_totp_step(UUID, BIGINT) TO helpdesk_app;
