import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from './role.js';
import { RolesGuard } from './roles.guard.js';

const context = (user?: { role: Role }) =>
  ({
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

const guardAllowing = (roles: Role[] | undefined) =>
  new RolesGuard({ getAllAndOverride: () => roles } as unknown as Reflector);

describe('RolesGuard', () => {
  it('lets a user with an allowed role through', () => {
    expect(
      guardAllowing(['ADMIN', 'AGENT']).canActivate(context({ role: 'AGENT' })),
    ).toBe(true);
  });

  it('rejects a user whose role is not allowed', () => {
    expect(() =>
      guardAllowing(['ADMIN']).canActivate(context({ role: 'CUSTOMER' })),
    ).toThrow(ForbiddenException);
  });

  it('denies by default when the route has no @Roles()', () => {
    expect(() =>
      guardAllowing(undefined).canActivate(context({ role: 'ADMIN' })),
    ).toThrow(/No roles configured/);
    expect(() =>
      guardAllowing([]).canActivate(context({ role: 'ADMIN' })),
    ).toThrow(ForbiddenException);
  });

  it('rejects when there is no authenticated user on the request', () => {
    expect(() =>
      guardAllowing(['ADMIN']).canActivate(context(undefined)),
    ).toThrow(ForbiddenException);
  });
});
