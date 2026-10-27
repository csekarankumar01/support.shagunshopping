// Creates (or resets the password of) a platform super admin. Run on the server, never exposed through the API:
//
//   npm run platform:create-admin -- you@example.com            generates a strong password and prints it once
//   PLATFORM_ADMIN_PASSWORD=... npm run platform:create-admin -- you@example.com   uses the password you give
//
// Connects as the database OWNER (POSTGRES_* in ../.env), because the app role cannot touch platform_admins.
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import pg from 'pg';
import { ownerConnection } from './connection.mjs';

const email = (process.argv[2] ?? '').trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Usage: npm run platform:create-admin -- you@example.com');
  process.exit(1);
}

const supplied = process.env.PLATFORM_ADMIN_PASSWORD;
if (supplied !== undefined && (supplied.length < 12 || supplied.length > 72)) {
  console.error('PLATFORM_ADMIN_PASSWORD must be 12 to 72 characters.');
  process.exit(1);
}
const generated = supplied === undefined;
const password = supplied ?? randomBytes(15).toString('base64url');
const hash = await bcrypt.hash(password, 12);

const client = new pg.Client(ownerConnection());
await client.connect();
try {
  const { rows } = await client.query(
    `INSERT INTO platform_admins (email, password_hash) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_active = true
     RETURNING (xmax = 0) AS created`,
    [email, hash],
  );
  console.log(`${rows[0].created ? 'Created' : 'Updated'} platform admin ${email}`);
  if (generated) console.log(`Password (shown once, store it safely): ${password}`);
} finally {
  await client.end();
}
