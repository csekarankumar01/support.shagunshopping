-- SLA engine: when the first public staff reply happened, and when (if ever) the deadline was missed.
ALTER TABLE tickets
    ADD COLUMN first_response_at TIMESTAMPTZ,
    ADD COLUMN sla_breached_at   TIMESTAMPTZ;

-- Some audit entries are made by the system itself (an SLA breach), not by a user.
-- The composite foreign key is skipped when actor_id is NULL.
ALTER TABLE audit_logs ALTER COLUMN actor_id DROP NOT NULL;

-- "Assigned to me" and "unassigned" queue filters.
CREATE INDEX tickets_org_agent_idx ON tickets (org_id, agent_id);

-- Canned responses: reusable reply texts, per organisation.
CREATE TABLE canned_responses (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id     UUID NOT NULL REFERENCES organizations (id),
    title      TEXT NOT NULL CHECK (length(btrim(title)) > 0),
    body       TEXT NOT NULL CHECK (length(btrim(body)) > 0),
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, title),
    FOREIGN KEY (created_by, org_id) REFERENCES users (id, org_id)
);

ALTER TABLE canned_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON canned_responses
    USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());
-- Deleting a canned response is a normal action, so DELETE is granted here (and only here).
GRANT SELECT, INSERT, UPDATE, DELETE ON canned_responses TO helpdesk_app;
