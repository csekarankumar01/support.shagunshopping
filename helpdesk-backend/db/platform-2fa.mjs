// Switches two-factor sign-in on (or off) for a platform admin. Run on the server:
//
//   npm run platform:2fa -- you@example.com            create a secret; shows what to add to your authenticator app
//   npm run platform:2fa -- you@example.com --off      turn it off (e.g. you lost your phone)
//
// Enabling happens in two steps so you cannot lock yourself out: the secret is stored switched OFF, and it only
// turns on after you type a valid code from your app.
import { createInterface } from 'node:readline/promises';
import pg from 'pg';
// The same code the API uses (built by `nest build`, which the npm script runs first).
import { encryptSecret, generateSecret, otpauthUrl, verifyCode } from '../dist/platform/totp.js';

const email = (process.argv[2] ?? '').trim().toLowerCase();
const off = process.argv.includes('--off');
if (!email.includes('@')) {
  console.error('Usage: npm run platform:2fa -- you@example.com [--off]');
  process.exit(1);
}
const appSecret = process.env.JWT_SECRET;
if (!appSecret) {
  console.error('JWT_SECRET is missing from ../.env');
  process.exit(1);
}

const client = new pg.Client({
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
});
await client.connect();
try {
  const found = await client.query('SELECT id FROM platform_admins WHERE email = $1', [email]);
  if (!found.rowCount) {
    console.error(`No platform admin ${email}. Create one with: npm run platform:create-admin -- ${email}`);
    process.exit(1);
  }
  if (off) {
    await client.query('UPDATE platform_admins SET totp_enabled = false, totp_secret = NULL, totp_last_step = 0 WHERE email = $1', [email]);
    console.log(`Two-factor sign-in switched off for ${email}`);
  } else {
    const secret = generateSecret();
    await client.query(
      'UPDATE platform_admins SET totp_secret = $2, totp_enabled = false, totp_last_step = 0 WHERE email = $1',
      [email, encryptSecret(secret, appSecret)],
    );
    console.log('\nAdd this account to your authenticator app (Google Authenticator, Microsoft Authenticator, Authy...):');
    console.log(`  Setup key : ${secret}   (choose "enter a setup key", type: time based)`);
    console.log(`  Or open   : ${otpauthUrl(email, secret)}   (paste into any QR generator)\n`);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const code = (await rl.question('Type the 6-digit code your app now shows: ')).trim();
    rl.close();
    const step = verifyCode(secret, code, 0);
    if (step === null) {
      console.error('That code is not right, so two-factor was NOT switched on. Run the command again.');
      process.exit(1);
    }
    await client.query('UPDATE platform_admins SET totp_enabled = true, totp_last_step = $2 WHERE email = $1', [email, step]);
    console.log(`Two-factor sign-in is now ON for ${email}. Sign in with the password plus a code from your app.`);
  }
} finally {
  await client.end();
}
