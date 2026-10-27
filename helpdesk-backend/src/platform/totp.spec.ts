import {
  base32Decode,
  base32Encode,
  codeForStep,
  decryptSecret,
  encryptSecret,
  generateSecret,
  stepAt,
  verifyCode,
} from './totp.js';

// RFC 6238 appendix B: the SHA-1 secret is the ASCII text "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('totp', () => {
  it('matches the RFC 6238 test vectors (last six digits of the 8-digit ones)', () => {
    expect(codeForStep(RFC_SECRET, stepAt(59_000))).toBe('287082');
    expect(codeForStep(RFC_SECRET, stepAt(1_111_111_109_000))).toBe('081804');
    expect(codeForStep(RFC_SECRET, stepAt(1_234_567_890_000))).toBe('005924');
  });

  it('round-trips base32', () => {
    const secret = generateSecret();
    expect(base32Encode(base32Decode(secret))).toBe(secret);
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  });

  it('accepts the current code and one window either side, and nothing else', () => {
    const now = 1_700_000_000_000;
    const step = stepAt(now);
    expect(verifyCode(RFC_SECRET, codeForStep(RFC_SECRET, step), 0, now)).toBe(step);
    expect(verifyCode(RFC_SECRET, codeForStep(RFC_SECRET, step - 1), 0, now)).toBe(step - 1);
    expect(verifyCode(RFC_SECRET, codeForStep(RFC_SECRET, step + 1), 0, now)).toBe(step + 1);
    expect(verifyCode(RFC_SECRET, codeForStep(RFC_SECRET, step - 2), 0, now)).toBeNull();
    expect(verifyCode(RFC_SECRET, '12345', 0, now)).toBeNull();
    expect(verifyCode(RFC_SECRET, 'abcdef', 0, now)).toBeNull();
  });

  it('refuses a code from a window that was already used', () => {
    const now = 1_700_000_000_000;
    const step = stepAt(now);
    const code = codeForStep(RFC_SECRET, step);
    expect(verifyCode(RFC_SECRET, code, step, now)).toBeNull();
    expect(verifyCode(RFC_SECRET, code, step - 1, now)).toBe(step);
  });

  it('stores the secret encrypted, and decrypts only with the right key', () => {
    const stored = encryptSecret(RFC_SECRET, 'app-secret');
    expect(stored).not.toContain(RFC_SECRET);
    expect(decryptSecret(stored, 'app-secret')).toBe(RFC_SECRET);
    expect(() => decryptSecret(stored, 'another-secret')).toThrow();
  });
});
