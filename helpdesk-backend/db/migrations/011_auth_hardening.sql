-- Account security: deactivating users, rotating refresh tokens, password reset, and SLA timer recovery.

-- A deactivated user cannot log in or refresh, and their open sessions are cut off immediately (see the app's
-- revocation list in Redis). Rows are never deleted, so tickets, comments and audit entries keep their author.
ALTER TABLE users
    ADD COLUMN is_active           BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Login now also has to know whether the account is active (return type changes, so drop and recreate).
DROP FUNCTION auth_lookup_user(TEXT, TEXT);
CREATE FUNCTION auth_lookup_user(p_slug TEXT, p_email TEXT)
RETURNS TABLE (id UUID, org_id UUID, role TEXT, password_hash TEXT, is_active BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT u.id, u.org_id, u.role, u.password_hash, u.is_active
      FROM users u
      JOIN organizations o ON o.id = u.org_id
     WHERE o.slug = p_slug AND u.email = p_email
$$;
REVOKE ALL ON FUNCTION auth_lookup_user(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_user(TEXT, TEXT) TO helpdesk_app;

-- Refresh tokens. The browser holds an opaque random string; only its SHA-256 is stored, so a database leak does not
-- leak sessions. Each use rotates the token (the old one is marked rotated and a new one issued). Presenting an
-- already-rotated token outside a short grace period means it was stolen and replayed: the whole family (one login
-- session) is revoked. The token string starts with the org id, so the app can set the tenant context before
-- looking it up, with no cross-tenant read.
CREATE TABLE refresh_tokens (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id            UUID NOT NULL REFERENCES organizations (id),
    user_id           UUID NOT NULL,
    family_id         UUID NOT NULL,
    family_started_at TIMESTAMPTZ NOT NULL,
    token_hash        TEXT NOT NULL UNIQUE,
    expires_at        TIMESTAMPTZ NOT NULL,
    rotated_at        TIMESTAMPTZ,
    revoked_at        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (user_id, org_id) REFERENCES users (id, org_id)
);
CREATE INDEX refresh_tokens_user_idx   ON refresh_tokens (org_id, user_id);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (org_id, family_id);

ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON refresh_tokens
    USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());
GRANT SELECT, INSERT, UPDATE ON refresh_tokens TO helpdesk_app;

-- Password reset links: single use, one hour, only the hash stored. Same org-id-prefixed token format.
CREATE TABLE password_resets (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id     UUID NOT NULL REFERENCES organizations (id),
    user_id    UUID NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (user_id, org_id) REFERENCES users (id, org_id)
);
CREATE INDEX password_resets_user_idx ON password_resets (org_id, user_id);

ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON password_resets
    USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());
GRANT SELECT, INSERT, UPDATE ON password_resets TO helpdesk_app;

-- SLA timer recovery. Timers live in Redis; if Redis loses its data the engine would forget every running deadline.
-- This lets the API rebuild them from the tickets themselves. It must see every tenant's tickets, which RLS forbids,
-- so it is a third narrow SECURITY DEFINER function: read-only, three columns, nothing else.
CREATE FUNCTION sla_pending_timers(p_limit INT)
RETURNS TABLE (org_id UUID, ticket_id UUID, sla_deadline TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT t.org_id, t.id, t.sla_deadline
      FROM tickets t
     WHERE t.status IN ('OPEN', 'IN_PROGRESS')
       AND t.first_response_at IS NULL
       AND t.sla_breached_at IS NULL
     ORDER BY t.sla_deadline
     LIMIT p_limit
$$;
REVOKE ALL ON FUNCTION sla_pending_timers(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sla_pending_timers(INT) TO helpdesk_app;
