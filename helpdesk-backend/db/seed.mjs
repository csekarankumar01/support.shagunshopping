import bcrypt from 'bcrypt';
import pg from 'pg';
import { ownerConnection } from './connection.mjs';

const client = new pg.Client(ownerConnection());
await client.connect();

try {
  const commonPassword = 'Password123!';
  const passwordHash = await bcrypt.hash(commonPassword, 12);

  // 1. Create or get Acme Support organization
  const orgResult = await client.query(
    `INSERT INTO organizations (slug, name, plan, sla_mins)
     VALUES ('acme', 'Acme Support', 'PRO', 120)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, slug, name`,
  );
  const org = orgResult.rows[0];
  console.log(`Organization: ${org.name} (slug: ${org.slug})`);

  // 2. Create users for every role
  const usersToSeed = [
    { email: 'admin@acme.com', role: 'ADMIN' },
    { email: 'agent@acme.com', role: 'AGENT' },
    { email: 'customer@acme.com', role: 'CUSTOMER' },
  ];

  const userMap = {};
  for (const u of usersToSeed) {
    const res = await client.query(
      `INSERT INTO users (org_id, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (org_id, email) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             role = EXCLUDED.role,
             is_active = true
       RETURNING id, email, role`,
      [org.id, u.email, passwordHash, u.role],
    );
    userMap[u.role] = res.rows[0];
    console.log(`Created/Updated user: ${u.email} [${u.role}]`);
  }

  // 3. Create a sample ticket
  const ticketDeadline = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours SLA
  const ticketRes = await client.query(
    `INSERT INTO tickets (org_id, requester_id, agent_id, subject, status, priority, sla_deadline)
     VALUES ($1, $2, $3, $4, 'OPEN', 'HIGH', $5)
     RETURNING id, subject`,
    [
      org.id,
      userMap['CUSTOMER'].id,
      userMap['AGENT'].id,
      'Unable to access payment gateway webhook integration',
      ticketDeadline,
    ],
  );
  const ticket = ticketRes.rows[0];
  console.log(`Created sample ticket: "${ticket.subject}"`);

  // 4. Create comments on ticket: Customer message, Agent public reply, and Agent private note
  await client.query(
    `INSERT INTO comments (ticket_id, org_id, author_id, message, is_internal_note)
     VALUES
       ($1, $2, $3, 'Hello! Our webhook endpoint is returning 403 Forbidden since morning. Could you please check if our IP was blocked?', false),
       ($1, $2, $4, 'Internal note: checked Cloudflare logs, seems rate-limited due to sudden retry burst.', true),
       ($1, $2, $4, 'Hi there! We are currently investigating the rate limit thresholds on the gateway. Will update you within 30 minutes.', false)`,
    [ticket.id, org.id, userMap['CUSTOMER'].id, userMap['AGENT'].id],
  );
  console.log('Created sample comments and internal note');

  // 5. Create a canned response
  await client.query(
    `INSERT INTO canned_responses (org_id, title, body, created_by)
     VALUES ($1, 'Standard Troubleshooting', 'Please verify your API key and check that port 443 is accessible from your server.', $2)
     ON CONFLICT (org_id, title) DO NOTHING`,
    [org.id, userMap['AGENT'].id],
  );
  console.log('Created sample canned response');

  console.log('\nSeed completed successfully!');
} finally {
  await client.end();
}
