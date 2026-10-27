import { createHash } from 'node:crypto';
import { newOpaqueToken, parseOpaqueToken } from './session.service.js';

const ORG = '4b7f7b0e-6b1e-4f43-9d1e-0a1b2c3d4e5f';

describe('opaque tokens (refresh tokens and password-reset links)', () => {
  it('starts with the org id, followed by 256 bits of randomness', () => {
    const { raw } = newOpaqueToken(ORG);
    expect(raw).toMatch(new RegExp(`^${ORG}\\.[A-Za-z0-9_-]{43}$`));
  });

  it('never repeats', () => {
    const seen = new Set(
      Array.from({ length: 500 }, () => newOpaqueToken(ORG).raw),
    );
    expect(seen.size).toBe(500);
  });

  it('is stored as a SHA-256 hash that cannot be turned back into the token', () => {
    const { raw, hash } = newOpaqueToken(ORG);
    expect(hash).toBe(createHash('sha256').update(raw).digest('hex'));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(raw.split('.')[1]);
  });

  it('is parsed back into the org it names and the same hash', () => {
    const { raw, hash } = newOpaqueToken(ORG);
    expect(parseOpaqueToken(raw)).toEqual({ orgId: ORG, hash });
  });

  it('refuses anything that is not exactly that shape', () => {
    const { raw } = newOpaqueToken(ORG);
    const [org, secret] = raw.split('.');
    for (const bad of [
      undefined,
      null,
      42,
      {},
      '',
      'nonsense',
      raw + 'x', // too long
      `${org}.${secret.slice(1)}`, // too short
      `${org.toUpperCase()}.${secret}`, // org id must be lower-case hex
      `not-a-uuid.${secret}`,
      `${org}.${secret}.extra`,
      `${org}.${'!'.repeat(43)}`, // characters outside base64url
      ` ${raw}`,
    ]) {
      expect(parseOpaqueToken(bad)).toBeNull();
    }
  });
});
