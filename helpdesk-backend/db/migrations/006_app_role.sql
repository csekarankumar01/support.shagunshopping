-- The application connects as helpdesk_app, NOT as the owner/superuser (superusers bypass Row-Level
-- Security). Its password is set from .env by db/migrate.mjs, never stored in this file.
-- Least privilege: no DELETE yet (nothing deletes), audit_logs is insert/read only.
-- Every future migration that adds a table must GRANT on it here-style, or the app cannot use it.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helpdesk_app') THEN
        CREATE ROLE helpdesk_app NOLOGIN;
    END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO helpdesk_app;
GRANT SELECT, INSERT, UPDATE ON organizations, users, tickets, comments TO helpdesk_app;
GRANT SELECT, INSERT ON audit_logs TO helpdesk_app;
