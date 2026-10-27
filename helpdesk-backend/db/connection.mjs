// How the command-line database tools (migrate, create-platform-admin, platform-2fa) connect, as the database OWNER.
//
// Either set DATABASE_URL (one value; hosted databases such as Render show it ready to copy), or the separate
// POSTGRES_HOST / POSTGRES_PORT / POSTGRES_DB / POSTGRES_USER / POSTGRES_PASSWORD (what the local Docker setup uses).
// POSTGRES_SSL=true encrypts the connection without checking the server's certificate chain (what most hosted
// databases need); POSTGRES_SSL=verify also checks it. Unset: no TLS.

const ssl = () =>
  process.env.POSTGRES_SSL === 'verify' ? true : process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : undefined;

/** True when the connection comes from one DATABASE_URL (so the database itself cannot be chosen separately). */
export const usesUrl = () => Boolean(process.env.DATABASE_URL);

export function ownerConnection(database) {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL, ssl: ssl() };
  }
  const missing = ['POSTGRES_HOST', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB'].filter((name) => !process.env[name]);
  if (missing.length) {
    // Without this check the tool quietly tries "localhost", and on a server the failure is a confusing
    // "connection refused 127.0.0.1:5432".
    throw new Error(
      `Cannot tell which database to use: ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} not set. ` +
        'Set DATABASE_URL (one value), or all the POSTGRES_* variables.',
    );
  }
  return {
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: database ?? process.env.POSTGRES_DB,
    ssl: ssl(),
  };
}
