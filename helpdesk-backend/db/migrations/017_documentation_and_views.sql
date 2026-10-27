-- Makes the database self-explanatory: a description on every table and column (visible in DBeaver and psql \d+),
-- and read-only "v_*" views that show names and emails instead of UUIDs. Views are security_invoker, so the app
-- role still sees only its own organisation's rows; the database owner (DBeaver) sees everything.
-- To EDIT data, change the underlying tables (a view that joins several tables cannot be edited).

-- ---------------------------------------------------------------- tables
COMMENT ON TABLE organizations    IS 'Tenants: one row per client company. Everything else hangs off org_id.';
COMMENT ON TABLE users            IS 'People who sign in to an organisation: admins, agents and customers. Unique per (org_id, email).';
COMMENT ON TABLE tickets          IS 'A support request raised by a customer (requester) and worked by staff (agent).';
COMMENT ON TABLE comments         IS 'Messages on a ticket. is_internal_note = true means staff-only; customers never see those.';
COMMENT ON TABLE audit_logs       IS 'Append-only history of ticket changes (created, status, assignment, SLA breach).';
COMMENT ON TABLE notifications    IS 'Log of emails the system sent or tried to send (receipts, SLA alerts).';
COMMENT ON TABLE canned_responses IS 'Saved replies that staff insert into tickets.';
COMMENT ON TABLE outbox_events    IS 'Events waiting to be published to Kafka (transactional outbox). Rows are removed once published.';
COMMENT ON TABLE dead_letters     IS 'Events a background consumer gave up on after retries; shown to admins as "Failed events".';
COMMENT ON TABLE refresh_tokens   IS 'Login sessions. Only a SHA-256 hash of each token is stored, never the token.';
COMMENT ON TABLE password_resets  IS 'Single-use password reset and invitation links (hash only).';
COMMENT ON TABLE platform_admins  IS 'Super admins: the SaaS operator above all organisations. Created only from the server command.';
COMMENT ON TABLE platform_audit_logs IS 'Append-only record of what platform admins did, including every look at ticket contents.';
COMMENT ON TABLE schema_migrations IS 'Which numbered migration files have been applied (with checksums).';

-- ---------------------------------------------------------------- organizations
COMMENT ON COLUMN organizations.id               IS 'Tenant id (UUID). Appears as org_id in every other table.';
COMMENT ON COLUMN organizations.slug             IS 'Short unique name used to sign in, e.g. "acme".';
COMMENT ON COLUMN organizations.name             IS 'Display name of the company.';
COMMENT ON COLUMN organizations.plan             IS 'FREE, PRO or ENT.';
COMMENT ON COLUMN organizations.sla_mins         IS 'Minutes allowed for the first staff reply; sets each new ticket sla_deadline.';
COMMENT ON COLUMN organizations.suspended_at     IS 'Set when a platform admin suspends the organisation; NULL means active.';
COMMENT ON COLUMN organizations.suspended_reason IS 'Why it was suspended (shown to platform admins).';
COMMENT ON COLUMN organizations.created_at       IS 'When the organisation registered.';

-- ---------------------------------------------------------------- users
COMMENT ON COLUMN users.id                  IS 'User id (UUID).';
COMMENT ON COLUMN users.org_id              IS 'Organisation this user belongs to.';
COMMENT ON COLUMN users.email               IS 'Login email, always lowercase; unique within the organisation.';
COMMENT ON COLUMN users.password_hash       IS 'bcrypt hash of the password. Never the password.';
COMMENT ON COLUMN users.role                IS 'ADMIN, AGENT or CUSTOMER.';
COMMENT ON COLUMN users.is_active           IS 'false = deactivated: cannot sign in, sessions ended. Rows are kept so history keeps its author.';
COMMENT ON COLUMN users.is_online           IS 'Unused: presence lives in Redis.';
COMMENT ON COLUMN users.password_changed_at IS 'When the password was last set.';
COMMENT ON COLUMN users.created_at          IS 'When the user was added.';

-- ---------------------------------------------------------------- tickets
COMMENT ON COLUMN tickets.id                IS 'Ticket id (UUID).';
COMMENT ON COLUMN tickets.org_id            IS 'Owning organisation.';
COMMENT ON COLUMN tickets.requester_id      IS 'The customer who raised it (users.id).';
COMMENT ON COLUMN tickets.agent_id          IS 'Staff member it is assigned to (users.id), or NULL if unassigned.';
COMMENT ON COLUMN tickets.subject           IS 'One-line title.';
COMMENT ON COLUMN tickets.status            IS 'OPEN, IN_PROGRESS, RESOLVED or CLOSED.';
COMMENT ON COLUMN tickets.priority          IS 'LOW, MEDIUM, HIGH or URGENT. Raised one level automatically on an SLA breach.';
COMMENT ON COLUMN tickets.sla_deadline      IS 'created_at plus the organisation sla_mins at creation time.';
COMMENT ON COLUMN tickets.first_response_at IS 'When staff first replied publicly (stops the SLA clock).';
COMMENT ON COLUMN tickets.sla_breached_at   IS 'When the SLA was missed; NULL if not breached.';
COMMENT ON COLUMN tickets.created_at        IS 'When the ticket was raised.';
COMMENT ON COLUMN tickets.updated_at        IS 'Last status or assignment change.';

-- ---------------------------------------------------------------- comments
COMMENT ON COLUMN comments.id               IS 'Comment id (UUID).';
COMMENT ON COLUMN comments.ticket_id        IS 'Ticket it belongs to.';
COMMENT ON COLUMN comments.org_id           IS 'Owning organisation.';
COMMENT ON COLUMN comments.author_id        IS 'Who wrote it (users.id).';
COMMENT ON COLUMN comments.message          IS 'The text.';
COMMENT ON COLUMN comments.is_internal_note IS 'true = staff only.';
COMMENT ON COLUMN comments.created_at       IS 'When it was posted.';

-- ---------------------------------------------------------------- audit_logs
COMMENT ON COLUMN audit_logs.id         IS 'Entry id.';
COMMENT ON COLUMN audit_logs.org_id     IS 'Owning organisation.';
COMMENT ON COLUMN audit_logs.ticket_id  IS 'Ticket the change was about.';
COMMENT ON COLUMN audit_logs.actor_id   IS 'Who did it (users.id); NULL when the system did (e.g. SLA breach).';
COMMENT ON COLUMN audit_logs.action     IS 'TICKET_CREATED, STATUS_CHANGED, ASSIGNED or SLA_BREACHED.';
COMMENT ON COLUMN audit_logs.old_val    IS 'Value before the change.';
COMMENT ON COLUMN audit_logs.new_val    IS 'Value after the change.';
COMMENT ON COLUMN audit_logs.created_at IS 'When it happened.';

-- ---------------------------------------------------------------- notifications and the rest
COMMENT ON COLUMN notifications.kind            IS 'TICKET_RECEIPT or SLA_BREACH_ALERT.';
COMMENT ON COLUMN notifications.recipient_email IS 'Where the email was sent.';
COMMENT ON COLUMN notifications.status          IS 'PENDING, SENT or FAILED.';
COMMENT ON COLUMN notifications.attempts        IS 'How many times sending was tried.';
COMMENT ON COLUMN notifications.last_error      IS 'Error from the last failed attempt.';
COMMENT ON COLUMN canned_responses.title        IS 'Short label staff pick from.';
COMMENT ON COLUMN canned_responses.body         IS 'The reply text that gets inserted.';
COMMENT ON COLUMN canned_responses.created_by   IS 'Staff member who saved it.';
COMMENT ON COLUMN dead_letters.consumer         IS 'Which background job failed: notifications, audit or sla.';
COMMENT ON COLUMN dead_letters.error            IS 'The error from the last attempt.';
COMMENT ON COLUMN dead_letters.attempts         IS 'How many times it was tried before giving up.';
COMMENT ON COLUMN dead_letters.payload          IS 'The original Kafka message.';
COMMENT ON COLUMN refresh_tokens.family_id      IS 'One login session; its tokens rotate and share this id (it is the JWT sid).';
COMMENT ON COLUMN platform_admins.email         IS 'Login email of the super admin (lowercase).';
COMMENT ON COLUMN platform_admins.is_active     IS 'false = cannot sign in; takes effect immediately.';
COMMENT ON COLUMN platform_audit_logs.action    IS 'What was done, e.g. ORG_SUSPENDED, ORG_UPDATED, USER_UPDATED, TICKET_VIEWED.';
COMMENT ON COLUMN platform_audit_logs.details   IS 'Before/after values or the reason given.';

-- ---------------------------------------------------------------- readable views
CREATE VIEW v_organizations WITH (security_invoker = true) AS
SELECT o.slug,
       o.name,
       o.plan,
       o.sla_mins,
       CASE WHEN o.suspended_at IS NULL THEN 'ACTIVE' ELSE 'SUSPENDED' END AS status,
       (SELECT count(*) FROM users u WHERE u.org_id = o.id AND u.role = 'ADMIN')    AS admins,
       (SELECT count(*) FROM users u WHERE u.org_id = o.id AND u.role = 'AGENT')    AS agents,
       (SELECT count(*) FROM users u WHERE u.org_id = o.id AND u.role = 'CUSTOMER') AS customers,
       (SELECT count(*) FROM tickets t WHERE t.org_id = o.id)                       AS tickets,
       (SELECT count(*) FROM tickets t WHERE t.org_id = o.id AND t.status IN ('OPEN', 'IN_PROGRESS')) AS open_tickets,
       o.created_at,
       o.id AS org_id
  FROM organizations o;

CREATE VIEW v_users WITH (security_invoker = true) AS
SELECT o.name AS organisation, u.email, u.role, u.is_active, u.created_at, u.password_changed_at, u.id AS user_id, u.org_id
  FROM users u JOIN organizations o ON o.id = u.org_id;

CREATE VIEW v_tickets WITH (security_invoker = true) AS
SELECT o.name AS organisation,
       t.subject,
       t.status,
       t.priority,
       r.email AS requester,
       a.email AS assigned_to,
       t.sla_deadline,
       t.sla_breached_at IS NOT NULL AS sla_breached,
       t.first_response_at,
       t.created_at,
       t.updated_at,
       t.id AS ticket_id,
       t.org_id
  FROM tickets t
  JOIN organizations o ON o.id = t.org_id
  JOIN users r ON r.id = t.requester_id AND r.org_id = t.org_id
  LEFT JOIN users a ON a.id = t.agent_id AND a.org_id = t.org_id;

CREATE VIEW v_comments WITH (security_invoker = true) AS
SELECT o.name AS organisation, t.subject AS ticket, u.email AS author, u.role AS author_role,
       c.message, c.is_internal_note, c.created_at, c.id AS comment_id, c.ticket_id, c.org_id
  FROM comments c
  JOIN organizations o ON o.id = c.org_id
  JOIN tickets t ON t.id = c.ticket_id AND t.org_id = c.org_id
  JOIN users u ON u.id = c.author_id AND u.org_id = c.org_id;

CREATE VIEW v_audit_logs WITH (security_invoker = true) AS
SELECT o.name AS organisation, t.subject AS ticket, coalesce(u.email, 'system') AS actor,
       l.action, l.old_val, l.new_val, l.created_at, l.id AS audit_id, l.org_id
  FROM audit_logs l
  JOIN organizations o ON o.id = l.org_id
  LEFT JOIN tickets t ON t.id = l.ticket_id AND t.org_id = l.org_id
  LEFT JOIN users u ON u.id = l.actor_id AND u.org_id = l.org_id;

COMMENT ON VIEW v_organizations IS 'Read-only: one row per organisation with user and ticket counts. Edit the organizations table to change data.';
COMMENT ON VIEW v_users         IS 'Read-only: users with their organisation name. Edit the users table to change data.';
COMMENT ON VIEW v_tickets       IS 'Read-only: tickets with organisation, requester and assignee names. Edit the tickets table to change data.';
COMMENT ON VIEW v_comments      IS 'Read-only: comments with ticket subject and author.';
COMMENT ON VIEW v_audit_logs    IS 'Read-only: ticket history with who did it.';

GRANT SELECT ON v_organizations, v_users, v_tickets, v_comments, v_audit_logs TO helpdesk_app;
