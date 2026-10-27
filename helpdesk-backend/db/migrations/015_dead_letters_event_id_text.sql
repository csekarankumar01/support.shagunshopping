-- Event ids are the outbox row ids (numbers), not UUIDs. Store them as text.
ALTER TABLE dead_letters ALTER COLUMN event_id TYPE TEXT USING event_id::text;
