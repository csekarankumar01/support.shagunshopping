BEGIN;

-- Target for composite foreign keys: lets other tables prove "this user belongs to THIS org".
ALTER TABLE users ADD CONSTRAINT users_id_org_key UNIQUE (id, org_id);

CREATE TABLE tickets (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       UUID NOT NULL REFERENCES organizations (id),
    requester_id UUID NOT NULL,
    agent_id     UUID,
    subject      TEXT NOT NULL CHECK (length(btrim(subject)) > 0),
    status       TEXT NOT NULL DEFAULT 'OPEN'
                 CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')),
    priority     TEXT NOT NULL DEFAULT 'MEDIUM'
                 CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
    sla_deadline TIMESTAMPTZ NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (id, org_id),
    FOREIGN KEY (requester_id, org_id) REFERENCES users (id, org_id),
    FOREIGN KEY (agent_id, org_id)     REFERENCES users (id, org_id)
);

-- Agent queue: "open urgent tickets in my org".
CREATE INDEX tickets_org_status_priority_idx ON tickets (org_id, status, priority);

CREATE TABLE comments (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id        UUID NOT NULL,
    org_id           UUID NOT NULL REFERENCES organizations (id),
    author_id        UUID NOT NULL,
    message          TEXT NOT NULL CHECK (length(btrim(message)) > 0),
    is_internal_note BOOLEAN NOT NULL DEFAULT false,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (ticket_id, org_id) REFERENCES tickets (id, org_id),
    FOREIGN KEY (author_id, org_id) REFERENCES users (id, org_id)
);

CREATE INDEX comments_org_ticket_idx ON comments (org_id, ticket_id, created_at);

CREATE TABLE audit_logs (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id     UUID NOT NULL REFERENCES organizations (id),
    ticket_id  UUID NOT NULL,
    actor_id   UUID NOT NULL,
    action     TEXT NOT NULL,
    old_val    TEXT,
    new_val    TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (ticket_id, org_id) REFERENCES tickets (id, org_id),
    FOREIGN KEY (actor_id, org_id)  REFERENCES users (id, org_id)
);

CREATE INDEX audit_logs_org_ticket_idx ON audit_logs (org_id, ticket_id, created_at);

-- Append-only: no edits, no deletes.
CREATE FUNCTION audit_logs_block_changes() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs is append-only';
END;
$$;

CREATE TRIGGER audit_logs_append_only
    BEFORE UPDATE OR DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION audit_logs_block_changes();

COMMIT;
