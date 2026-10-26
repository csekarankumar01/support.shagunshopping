-- Row-Level Security: the database itself hides other tenants' rows from the app role.
-- The app sets `app.current_org_id` (transaction-local) from the verified JWT before each query.
-- If it is not set, app_current_org() is NULL, `org_id = NULL` is never true, and no rows are visible.
--
-- Not FORCEd on purpose: the table owner (used only for migrations and admin work) bypasses RLS.
-- The app role is not the owner, so the policies always apply to it.

-- NULLIF: after a transaction ends the setting reads '' (not NULL), and ''::uuid would raise an error.
CREATE FUNCTION app_current_org() RETURNS uuid
LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.current_org_id', true), '')::uuid
$$;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON organizations
    USING (id = app_current_org()) WITH CHECK (id = app_current_org());

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON users
    USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());

ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tickets
    USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());

ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON comments
    USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_logs
    USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());

-- Login happens BEFORE the tenant is known, so it cannot satisfy the policies above.
-- This one narrow function (runs as its owner, which bypasses RLS) is the only cross-tenant read:
-- it returns at most one row, for an exact (org slug, email) pair, and nothing else.
CREATE FUNCTION auth_lookup_user(p_slug TEXT, p_email TEXT)
RETURNS TABLE (id UUID, org_id UUID, role TEXT, password_hash TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT u.id, u.org_id, u.role, u.password_hash
      FROM users u
      JOIN organizations o ON o.id = u.org_id
     WHERE o.slug = p_slug AND u.email = p_email
$$;

REVOKE ALL ON FUNCTION auth_lookup_user(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_user(TEXT, TEXT) TO helpdesk_app;
