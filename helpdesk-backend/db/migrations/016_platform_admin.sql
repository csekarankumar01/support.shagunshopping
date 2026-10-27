-- Platform (super) admin: the SaaS operator, who sits ABOVE every organisation.
--
-- Design rules:
--  * Platform admins live in their own table with no org_id. They are not users of any organisation and use their
--    own login (/api/v1/platform/login) whose token a tenant endpoint refuses (and vice versa).
--  * The app role cannot read platform_admins directly; it reaches it only through three narrow SECURITY DEFINER
--    functions (like auth_lookup_user). Admins are created from the server with `npm run platform:create-admin`,
--    never through the API.
--  * Cross-tenant access goes through Row-Level Security, not around it: when the API runs a platform request it
--    sets `app.platform_admin = 'on'` for that transaction, and extra policies below let that context read every
--    tenant (and edit organisations, users and sessions). Normal tenant requests never set it.
--  * Everything a platform admin edits, and every look at ticket contents, is recorded in platform_audit_logs.

CREATE FUNCTION app_is_platform() RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT coalesce(current_setting('app.platform_admin', true), '') = 'on'
$$;

-- An organisation can be suspended (its people cannot sign in) without deleting anything.
ALTER TABLE organizations
    ADD COLUMN suspended_at     TIMESTAMPTZ,
    ADD COLUMN suspended_reason TEXT;

CREATE TABLE platform_admins (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
    password_hash TEXT NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ
);
REVOKE ALL ON platform_admins FROM PUBLIC;

CREATE FUNCTION platform_lookup_admin(p_email TEXT)
RETURNS TABLE (id UUID, email TEXT, password_hash TEXT, is_active BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT a.id, a.email, a.password_hash, a.is_active FROM platform_admins a WHERE a.email = p_email
$$;

CREATE FUNCTION platform_admin_is_active(p_id UUID) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT coalesce((SELECT a.is_active FROM platform_admins a WHERE a.id = p_id), false)
$$;

CREATE FUNCTION platform_touch_login(p_id UUID) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    UPDATE platform_admins SET last_login_at = now() WHERE id = p_id
$$;

REVOKE ALL ON FUNCTION platform_lookup_admin(TEXT), platform_admin_is_active(UUID), platform_touch_login(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_lookup_admin(TEXT), platform_admin_is_active(UUID), platform_touch_login(UUID) TO helpdesk_app;

-- Append-only record of what platform admins did (no UPDATE or DELETE is granted). org_id has no foreign key on
-- purpose: the history must survive even if an organisation is ever removed.
CREATE TABLE platform_audit_logs (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    admin_id    UUID NOT NULL REFERENCES platform_admins (id),
    admin_email TEXT NOT NULL,
    action      TEXT NOT NULL,
    org_id      UUID,
    target_type TEXT,
    target_id   TEXT,
    details     JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX platform_audit_logs_created_idx ON platform_audit_logs (created_at DESC);
CREATE INDEX platform_audit_logs_org_idx ON platform_audit_logs (org_id, created_at DESC);

ALTER TABLE platform_audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_only ON platform_audit_logs USING (app_is_platform()) WITH CHECK (app_is_platform());
GRANT SELECT, INSERT ON platform_audit_logs TO helpdesk_app;

-- Platform read access to every tenant table (added next to each table's tenant_isolation policy; policies OR).
CREATE POLICY platform_read ON organizations    FOR SELECT USING (app_is_platform());
CREATE POLICY platform_read ON users            FOR SELECT USING (app_is_platform());
CREATE POLICY platform_read ON tickets          FOR SELECT USING (app_is_platform());
CREATE POLICY platform_read ON comments         FOR SELECT USING (app_is_platform());
CREATE POLICY platform_read ON audit_logs       FOR SELECT USING (app_is_platform());
CREATE POLICY platform_read ON notifications    FOR SELECT USING (app_is_platform());
CREATE POLICY platform_read ON canned_responses FOR SELECT USING (app_is_platform());
CREATE POLICY platform_read ON dead_letters     FOR SELECT USING (app_is_platform());

-- Platform edits: organisations (name, plan, SLA, suspension), users (role, active) and ending their sessions.
CREATE POLICY platform_update ON organizations   FOR UPDATE USING (app_is_platform()) WITH CHECK (app_is_platform());
CREATE POLICY platform_update ON users           FOR UPDATE USING (app_is_platform()) WITH CHECK (app_is_platform());
CREATE POLICY platform_update ON refresh_tokens  FOR UPDATE USING (app_is_platform()) WITH CHECK (app_is_platform());
CREATE POLICY platform_read   ON refresh_tokens  FOR SELECT USING (app_is_platform());

-- Login must now also know whether the organisation is suspended.
DROP FUNCTION auth_lookup_user(TEXT, TEXT);
CREATE FUNCTION auth_lookup_user(p_slug TEXT, p_email TEXT)
RETURNS TABLE (id UUID, org_id UUID, role TEXT, password_hash TEXT, is_active BOOLEAN, org_suspended BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT u.id, u.org_id, u.role, u.password_hash, u.is_active, o.suspended_at IS NOT NULL
      FROM users u
      JOIN organizations o ON o.id = u.org_id
     WHERE o.slug = p_slug AND u.email = p_email
$$;
REVOKE ALL ON FUNCTION auth_lookup_user(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_user(TEXT, TEXT) TO helpdesk_app;
