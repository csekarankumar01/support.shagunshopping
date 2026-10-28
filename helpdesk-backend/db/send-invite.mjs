import pg from 'pg';
import crypto from 'crypto';
import { Resend } from 'resend';

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

try {
  const targetEmail = process.argv[2] ?? 'cse.karankumar01@gmail.com';
  console.log(`Sending invite for: ${targetEmail}`);

  // 1. Get user and organization
  const userRes = await client.query(
    `SELECT u.id, u.email, u.role, u.org_id, o.name as org_name, o.slug as org_slug
     FROM users u
     JOIN organizations o ON o.id = u.org_id
     WHERE u.email = $1`,
    [targetEmail],
  );
  const user = userRes.rows[0];

  if (!user) {
    console.error(`User with email "${targetEmail}" not found in database.`);
    process.exit(1);
  }

  // 2. Generate opaque token
  const secret = crypto.randomBytes(32).toString('base64url');
  const rawToken = `${user.org_id}.${secret}`;
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  // 3. Invalidate old reset tokens and insert new one
  await client.query(
    `UPDATE password_resets SET used_at = now()
     WHERE org_id = $1 AND user_id = $2 AND used_at IS NULL`,
    [user.org_id, user.id],
  );
  await client.query(
    `INSERT INTO password_resets (org_id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + interval '72 hours')`,
    [user.org_id, user.id, tokenHash],
  );

  const baseUrl = process.env.FRONTEND_ORIGIN?.split(',')[0].trim() || 'https://flash-helpdesk.vercel.app';
  const inviteLink = `${baseUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;
  console.log('Generated Invite Link:', inviteLink);

  // 4. Send email via Resend
  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.MAIL_FROM ?? 'Flash HelpDesk <onboarding@resend.dev>';
  const { data, error } = await resend.emails.send({
    from,
    to: user.email,
    subject: `You have been invited to ${user.org_name}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; border: 1px solid #e2e8f0; border-radius: 16px; background: #ffffff;">
        <div style="margin-bottom: 24px;">
          <span style="background: #4f46e5; color: #ffffff; padding: 6px 12px; border-radius: 8px; font-weight: bold; font-size: 14px;">Helpdesk</span>
        </div>
        <h2 style="color: #0f172a; margin: 0 0 12px 0; font-size: 20px;">You've been invited!</h2>
        <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">
          You have been added as <strong>${user.role}</strong> to <strong>${user.org_name}</strong>.
        </p>
        <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 24px 0;">
          Click the button below to set your password and access the workspace:
        </p>
        <div style="margin: 0 0 28px 0;">
          <a href="${inviteLink}" style="background: #4f46e5; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 500; font-size: 15px; display: inline-block;">
            Set Your Password
          </a>
        </div>
        <div style="border-top: 1px solid #f1f5f9; padding-top: 20px;">
          <p style="color: #64748b; font-size: 13px; line-height: 1.5; margin: 0 0 8px 0;">
            This invitation link expires in 3 days and can only be used once.
          </p>
          <p style="color: #94a3b8; font-size: 12px; line-height: 1.5; margin: 0; word-break: break-all;">
            If the button doesn't work, copy and paste this URL into your browser:<br/>
            <a href="${inviteLink}" style="color: #4f46e5;">${inviteLink}</a>
          </p>
        </div>
      </div>
    `,
    text: `You have been added as ${user.role} to ${user.org_name}.\n\nChoose your password here:\n${inviteLink}\n\nThis link works once and expires in 3 days.\n`,
  });

  if (error) {
    console.error('Resend delivery failed:', error);
  } else {
    console.log('Resend email successfully delivered! ID:', data?.id);
  }
} finally {
  await client.end();
}
