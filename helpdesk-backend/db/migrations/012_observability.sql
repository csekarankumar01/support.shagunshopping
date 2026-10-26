-- For monitoring: how many events are waiting to be published, and how old the oldest is. A growing number means
-- the relay or the broker is in trouble. Read-only and across tenants (RLS would hide every row), so it is a narrow
-- SECURITY DEFINER function that returns two numbers and nothing else.
CREATE FUNCTION outbox_backlog()
RETURNS TABLE (pending BIGINT, oldest_seconds DOUBLE PRECISION)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT count(*)::bigint,
           COALESCE(extract(epoch FROM now() - min(created_at)), 0)::float8
      FROM outbox_events
$$;
REVOKE ALL ON FUNCTION outbox_backlog() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION outbox_backlog() TO helpdesk_app;
