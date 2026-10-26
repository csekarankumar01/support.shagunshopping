import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { verifyToken } from './verify-token.js';

const jwt = new JwtService({ secret: 'test-secret' });
const claims = {
  sub: 'user-1',
  orgId: 'org-1',
  role: 'AGENT',
  sid: 'session-1',
};
const sign = (payload: object, expiresIn = 60) =>
  jwt.sign(payload, { expiresIn });

describe('verifyToken', () => {
  it('accepts a login token as "access" and reports its own expiry as the session end', async () => {
    const token = sign(claims, 3600);
    const { user, sessionExp } = await verifyToken(jwt, token, 'access');
    expect(user).toEqual({ userId: 'user-1', orgId: 'org-1', role: 'AGENT' });
    expect(sessionExp).toBe(jwt.decode(token).exp);
  });

  it('accepts a socket token as "socket" and reports the session end it carries, not its own 60 seconds', async () => {
    const sessionEnd = Math.floor(Date.now() / 1000) + 3000;
    const token = sign({
      ...claims,
      purpose: 'socket',
      sessionExp: sessionEnd,
    });
    const verified = await verifyToken(jwt, token, 'socket');
    expect(verified.sessionExp).toBe(sessionEnd);
    expect(verified.user.orgId).toBe('org-1');
  });

  it('refuses a login token at the WebSocket door and a socket token at the REST door', async () => {
    await expect(verifyToken(jwt, sign(claims), 'socket')).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(
      verifyToken(jwt, sign({ ...claims, purpose: 'socket' }), 'access'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('refuses a socket token whose purpose is anything but "socket"', async () => {
    await expect(
      verifyToken(jwt, sign({ ...claims, purpose: 'admin' }), 'socket'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('refuses expired, foreign-secret and garbage tokens with the same error', async () => {
    const socketClaims = { ...claims, purpose: 'socket' };
    const foreign = new JwtService({ secret: 'other' }).sign(socketClaims, {
      expiresIn: 60,
    });
    for (const token of [sign(socketClaims, -10), foreign, 'abc.def.ghi']) {
      await expect(verifyToken(jwt, token, 'socket')).rejects.toThrow(
        'Invalid or expired token',
      );
    }
  });

  it('reports the session id, and refuses a token that has none', async () => {
    expect((await verifyToken(jwt, sign(claims), 'access')).sid).toBe(
      'session-1',
    );
    const { sid: _sid, ...withoutSession } = claims;
    await expect(
      verifyToken(jwt, sign(withoutSession), 'access'),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      verifyToken(
        jwt,
        sign({ ...withoutSession, purpose: 'socket' }),
        'socket',
      ),
    ).rejects.toThrow(UnauthorizedException);
  });
});
