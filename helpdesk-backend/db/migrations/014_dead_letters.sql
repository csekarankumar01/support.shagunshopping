-- Events a consumer gave up on (after its retries). The full message also goes to the "<topic>.dlq" Kafka topic;
-- this table lets an organisation's admin SEE them. UNIQUE makes a redelivered failure a no-op.
CREATE TABLE dead_letters (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES organizations (id),
    consumer    TEXT NOT NULL,
    topic       TEXT NOT NULL,
    event_id    UUID NOT NULL,
    event_type  TEXT NOT NULL,
    error       TEXT NOT NULL,
    attempts    INT NOT NULL,
    payload     TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (consumer, event_id)
);

CREATE INDEX dead_letters_org_created_idx ON dead_letters (org_id, created_at DESC);

ALTER TABLE dead_letters ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dead_letters
    USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());
GRANT SELECT, INSERT ON dead_letters TO helpdesk_app;
