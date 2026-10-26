-- Ticket lists are always ordered newest-first inside one org.
-- Agent/admin queue: all tickets of an org, newest first.
CREATE INDEX tickets_org_created_idx ON tickets (org_id, created_at DESC, id);
-- Customer "my tickets": one requester inside an org, newest first.
CREATE INDEX tickets_org_requester_created_idx ON tickets (org_id, requester_id, created_at DESC, id);
