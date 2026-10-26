-- Transactional outbox: an event is written in the SAME transaction as the change it announces, and a relay
-- publishes it to Kafka afterwards. A crash can no longer save a ticket but lose its event, and the HTTP request
-- never waits for the broker. Rows are deleted once published (delivery is at-least-once, consumers are idempotent).
CREATE TABLE outbox_events (
    id           BIGSERIAL PRIMARY KEY,
    org_id       UUID NOT NULL REFERENCES organizations (id),
    topic        TEXT NOT NULL,
    event_key    TEXT NOT NULL,           -- Kafka partition key: the org id, so one tenant's events stay in order
    payload      JSONB NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_until TIMESTAMPTZ              -- lease held by a relay that has claimed the row but not yet published it
);

CREATE INDEX outbox_events_id_idx ON outbox_events (id);

ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON outbox_events
    USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());

-- The app can only INSERT (inside a tenant transaction). Reading and deleting is the relay's job, below.
GRANT INSERT ON outbox_events TO helpdesk_app;
GRANT USAGE ON SEQUENCE outbox_events_id_seq TO helpdesk_app;

-- The relay must see every tenant's events, which RLS forbids, so it gets exactly two narrow functions
-- (like auth_lookup_user in 008): claim a batch under a 30-second lease, and delete what was published.
CREATE FUNCTION outbox_claim(p_limit INT)
RETURNS TABLE (id BIGINT, topic TEXT, event_key TEXT, payload JSONB)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    UPDATE outbox_events o
       SET locked_until = now() + interval '30 seconds'
     WHERE o.id IN (SELECT e.id FROM outbox_events e
                     WHERE e.locked_until IS NULL OR e.locked_until < now()
                     ORDER BY e.id LIMIT p_limit
                       FOR UPDATE SKIP LOCKED)
    RETURNING o.id, o.topic, o.event_key, o.payload
$$;

CREATE FUNCTION outbox_complete(p_ids BIGINT[]) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    DELETE FROM outbox_events WHERE id = ANY (p_ids)
$$;

REVOKE ALL ON FUNCTION outbox_claim(INT), outbox_complete(BIGINT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION outbox_claim(INT), outbox_complete(BIGINT[]) TO helpdesk_app;

-- Every email the system sends or tries to send. UNIQUE makes a redelivered event a no-op, never a second email.
CREATE TABLE notifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations (id),
    ticket_id       UUID NOT NULL,
    kind            TEXT NOT NULL CHECK (kind IN ('TICKET_RECEIPT', 'SLA_BREACH_ALERT')),
    recipient_id    UUID NOT NULL,
    recipient_email TEXT NOT NULL,
    subject         TEXT NOT NULL,
    body            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
    attempts        INT NOT NULL DEFAULT 0,
    last_error      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at         TIMESTAMPTZ,
    UNIQUE (ticket_id, kind, recipient_id),
    FOREIGN KEY (ticket_id, org_id)    REFERENCES tickets (id, org_id),
    FOREIGN KEY (recipient_id, org_id) REFERENCES users (id, org_id)
);

CREATE INDEX notifications_org_created_idx ON notifications (org_id, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notifications
    USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());
GRANT SELECT, INSERT, UPDATE ON notifications TO helpdesk_app;
