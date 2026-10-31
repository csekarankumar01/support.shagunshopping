import bcrypt from 'bcrypt';
import pg from 'pg';
import { ownerConnection } from './connection.mjs';

const client = new pg.Client(ownerConnection());
await client.connect();

try {
  const commonPassword = 'Password123!';
  const passwordHash = await bcrypt.hash(commonPassword, 12);

  // 1. Create or get Shagun Shopping organization
  const shagunOrgResult = await client.query(
    `INSERT INTO organizations (slug, name, plan, sla_mins)
     VALUES ('shagun', 'Shagun Shopping', 'PRO', 60)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, sla_mins = EXCLUDED.sla_mins
     RETURNING id, slug, name`,
  );
  const shagunOrg = shagunOrgResult.rows[0];
  console.log(`Organization: ${shagunOrg.name} (slug: ${shagunOrg.slug})`);

  // 2. Create users for Shagun Shopping
  const shagunUsers = [
    { email: 'admin@shagunshopping.com', role: 'ADMIN' },
    { email: 'support@shagunshopping.com', role: 'AGENT' },
    { email: 'customer@shagunshopping.com', role: 'CUSTOMER' },
    { email: 'priya.sharma@example.com', role: 'CUSTOMER' },
  ];

  const shagunUserMap = {};
  for (const u of shagunUsers) {
    const res = await client.query(
      `INSERT INTO users (org_id, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (org_id, email) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             role = EXCLUDED.role,
             is_active = true
       RETURNING id, email, role`,
      [shagunOrg.id, u.email, passwordHash, u.role],
    );
    shagunUserMap[u.email] = res.rows[0];
    console.log(`Created/Updated Shagun user: ${u.email} [${u.role}]`);
  }

  // 3. Create realistic Shagun e-commerce tickets
  const ticket1Deadline = new Date(Date.now() + 1 * 60 * 60 * 1000); // 1 hour SLA
  const ticket1Res = await client.query(
    `INSERT INTO tickets (org_id, requester_id, agent_id, subject, status, priority, sla_deadline)
     VALUES ($1, $2, $3, $4, 'OPEN', 'HIGH', $5)
     RETURNING id, subject`,
    [
      shagunOrg.id,
      shagunUserMap['customer@shagunshopping.com'].id,
      shagunUserMap['support@shagunshopping.com'].id,
      '[Order #SHG-8492] Damaged packaging on Dot & Key Vitamin C Serum',
      ticket1Deadline,
    ],
  );
  const ticket1 = ticket1Res.rows[0];
  console.log(`Created Shagun ticket: "${ticket1.subject}"`);

  await client.query(
    `INSERT INTO comments (ticket_id, org_id, author_id, message, is_internal_note)
     VALUES
       ($1, $2, $3, 'Namaste Shagun team, I received my parcel today (Delhivery tracking 849281923). The Dot & Key Vitamin C serum bottle had a cracked dropper and leaked inside the box. Could you please arrange a replacement?', false),
       ($1, $2, $4, 'Internal note: checked warehouse logs. Order packed on Oct 29. BlueDart reported transit mishandling. Dispatching replacement unit directly from Meerut store inventory.', true),
       ($1, $2, $4, 'Namaste! We sincerely apologize for this inconvenience. We have already initiated a free replacement for your Dot & Key serum. Your new AWB tracking link will be sent to your mobile number within 2 hours.', false)`,
    [ticket1.id, shagunOrg.id, shagunUserMap['customer@shagunshopping.com'].id, shagunUserMap['support@shagunshopping.com'].id],
  );

  const ticket2Res = await client.query(
    `INSERT INTO tickets (org_id, requester_id, agent_id, subject, status, priority, sla_deadline)
     VALUES ($1, $2, $3, $4, 'IN_PROGRESS', 'URGENT', $5)
     RETURNING id, subject`,
    [
      shagunOrg.id,
      shagunUserMap['priya.sharma@example.com'].id,
      shagunUserMap['support@shagunshopping.com'].id,
      '[Order #SHG-8501] BlueDart courier delayed beyond estimated delivery date',
      new Date(Date.now() + 30 * 60 * 1000),
    ],
  );
  const ticket2 = ticket2Res.rows[0];

  await client.query(
    `INSERT INTO comments (ticket_id, org_id, author_id, message, is_internal_note)
     VALUES
       ($1, $2, $3, 'Hello, my order #SHG-8501 was supposed to arrive yesterday. The BlueDart status is stuck at Delhi hub. Please help expedite.', false),
       ($1, $2, $4, 'Internal note: Raised ticket with BlueDart priority merchant desk (AWB #49281039). Promised delivery tomorrow by 2 PM.', true),
       ($1, $2, $4, 'Hi Priya! We have escalated this with the BlueDart Meerut-Delhi coordinator. It is out for transit and will reach you by tomorrow afternoon.', false)`,
    [ticket2.id, shagunOrg.id, shagunUserMap['priya.sharma@example.com'].id, shagunUserMap['support@shagunshopping.com'].id],
  );

  // 4. Create e-commerce canned responses for ShagunShopping
  const cannedResponses = [
    {
      title: 'Damaged & Leaked Item Replacement',
      body: 'Namaste! We sincerely apologize for the inconvenience. Every product dispatched from our Meerut store is 100% genuine and inspected. Please share a quick photo of the damaged bottle and outer box, and we will dispatch a free replacement immediately.',
    },
    {
      title: 'Courier & Order Tracking Info',
      body: 'Your order has been dispatched from our Meerut flagship store. You can track your parcel live with your tracking link sent via SMS and email. Standard delivery takes 2-4 business days across India.',
    },
    {
      title: 'Authenticity Guarantee (25+ Years)',
      body: 'Shagun has been Meerut’s trusted multi-brand cosmetic destination for over 25 years. All our skincare, haircare, and makeup products (Dot & Key, Lotus, Pilgrim, Swiss Beauty, etc.) are 100% authentic, sourced directly from brand distributors, and come with a GST invoice.',
    },
    {
      title: 'Return & Exchange Policy',
      body: 'Unopened and sealed cosmetic items can be exchanged or returned within 5 days of delivery. For hygiene reasons, opened beauty products cannot be accepted unless received in a damaged or defective state.',
    },
  ];

  for (const cr of cannedResponses) {
    await client.query(
      `INSERT INTO canned_responses (org_id, title, body, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (org_id, title) DO UPDATE SET body = EXCLUDED.body`,
      [shagunOrg.id, cr.title, cr.body, shagunUserMap['support@shagunshopping.com'].id],
    );
  }
  console.log('Created Shagun e-commerce canned responses');

  // 5. Retain Acme Support organization for test backward-compatibility
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
