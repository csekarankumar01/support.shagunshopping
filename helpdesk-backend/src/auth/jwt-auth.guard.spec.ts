import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard.js';

const jwt = new JwtService({ secret: 'test-secret' });
const guard = new JwtAuthGuard(jwt);
// Real login tokens always carry an expiry (JWT_EXPIRES_IN_SECONDS), so the test tokens do too.
const sign = (payload: object, options: { expiresIn?: number } = {}) =>
  jwt.sign(payload, { expiresIn: 60, ...options });

const requestWith = (authorization?: string) => {
  const request: { headers: { authorization?: string }; user?: unknown } = {
    headers: { authorization },
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { request, context };
};

const goodPayload = { sub: 'user-1', orgId: 'org-1', role: 'AGENT' };

describe('JwtAuthGuard', () => {
  it('accepts a valid token and sets userId, orgId and role from it', async () => {
    const { request, context } = requestWith(`Bearer ${sign(goodPayload)}`);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({
      userId: 'user-1',
      orgId: 'org-1',
      role: 'AGENT',
    });
  });

  it('rejects a missing header and a non-Bearer scheme', async () => {
    await expect(guard.canActivate(requestWith().context)).rejects.toThrow(
      /Missing bearer token/,
    );
    await expect(
      guard.canActivate(requestWith(`Basic ${sign(goodPayload)}`).context),
    ).rejects.toThrow(/Missing bearer token/);
  });

  it('rejects garbage', async () => {
    await expect(
      guard.canActivate(requestWith('Bearer abc.def.ghi').context),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a token with edited claims (signature no longer matches)', async () => {
    const [header, , signature] = sign(goodPayload).split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...goodPayload, orgId: 'org-2' }),
    ).toString('base64url');
    await expect(
      guard.canActivate(
        requestWith(`Bearer ${header}.${forged}.${signature}`).context,
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a token signed with a different secret', async () => {
    const foreign = new JwtService({ secret: 'someone-elses-secret' }).sign(
      goodPayload,
      { expiresIn: 60 },
    );
    await expect(
      guard.canActivate(requestWith(`Bearer ${foreign}`).context),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an expired token', async () => {
    const expired = sign(goodPayload, { expiresIn: -10 });
    await expect(
      guard.canActivate(requestWith(`Bearer ${expired}`).context),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a validly signed token that lacks orgId or has an unknown role', async () => {
    const noOrg = sign({ sub: 'user-1', role: 'AGENT' });
    const badRole = sign({ ...goodPayload, role: 'SUPERUSER' });
    await expect(
      guard.canActivate(requestWith(`Bearer ${noOrg}`).context),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      guard.canActivate(requestWith(`Bearer ${badRole}`).context),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a token that never expires', async () => {
    const eternal = jwt.sign(goodPayload); // no expiresIn: no exp claim
    await expect(
      guard.canActivate(requestWith(`Bearer ${eternal}`).context),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a 60-second socket token: it is for the WebSocket handshake only', async () => {
    const socketToken = sign({ ...goodPayload, purpose: 'socket' });
    await expect(
      guard.canActivate(requestWith(`Bearer ${socketToken}`).context),
    ).rejects.toThrow(UnauthorizedException);
  });
});
