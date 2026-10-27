import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Time-based one-time passwords (RFC 6238, the standard behind Google Authenticator, Microsoft Authenticator,
 * Authy, 1Password...): a 6-digit code derived from a shared secret and the current 30-second window.
 * Written on Node's own crypto, so there is no extra dependency.
 */
const STEP_SECONDS = 30;
const DIGITS = 6;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of text.toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    value = (value << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** A new random secret, as the base32 text an authenticator app expects (160 bits). */
export const generateSecret = () => base32Encode(randomBytes(20));

/** The 6-digit code for one time window (RFC 4226 dynamic truncation of HMAC-SHA1). */
export function codeForStep(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

export const stepAt = (ms: number) => Math.floor(ms / 1000 / STEP_SECONDS);

/**
 * Checks a typed code. Accepts the current window and one either side (clocks drift), compares in constant time,
 * and refuses any window at or before `lastStep`, so a code that was already used (or an older one) cannot be
 * replayed. Returns the window that matched, which the caller must store as the new lastStep; null if no match.
 */
export function verifyCode(
  secret: string,
  code: string,
  lastStep: number,
  nowMs = Date.now(),
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = stepAt(nowMs);
  let matched: number | null = null;
  for (const step of [current - 1, current, current + 1]) {
    const expected = Buffer.from(codeForStep(secret, step));
    // No early exit: the work done does not depend on which window matched.
    if (timingSafeEqual(expected, Buffer.from(code)) && step > lastStep) {
      matched = matched === null ? step : Math.max(matched, step);
    }
  }
  return matched;
}

/** What to put in a QR code or type into the authenticator app by hand. */
export const otpauthUrl = (email: string, secret: string) =>
  `otpauth://totp/Helpdesk%20Platform:${encodeURIComponent(email)}?secret=${secret}&issuer=Helpdesk%20Platform&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;

// --- the secret is stored encrypted, so a copy of the database alone is not enough to generate codes ---

const key = (appSecret: string) =>
  createHash('sha256').update(`platform-totp:${appSecret}`).digest();

export function encryptSecret(secret: string, appSecret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(appSecret), iv);
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

export function decryptSecret(stored: string, appSecret: string): string {
  const [iv, tag, data] = stored.split('.').map((part) => Buffer.from(part, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key(appSecret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
