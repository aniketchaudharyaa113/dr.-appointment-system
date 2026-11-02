import { describe, it, expect } from 'vitest';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../src/modules/identity/guards/roles.guard';
import { ROLES_KEY } from '../src/modules/identity/decorators/roles.decorator';

describe('RBAC Guard Tests (Role-Based Access Control)', () => {
  function createMockContext(userRole: string | undefined): ExecutionContext {
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          user: userRole ? { sub: 'user-1', email: 'u@test.com', role: userRole } : undefined,
        }),
      }),
    } as unknown as ExecutionContext;
  }

  it('allows access to public endpoints (no @Roles decorator)', () => {
    const reflector = new Reflector();
    reflector.getAllAndOverride = () => null;

    const guard = new RolesGuard(reflector);
    const ctx = createMockContext('PATIENT');

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows ADMIN to access ADMIN-protected endpoints', () => {
    const reflector = new Reflector();
    reflector.getAllAndOverride = (key: any) => (key === ROLES_KEY ? ['ADMIN'] : null);

    const guard = new RolesGuard(reflector);
    const ctx = createMockContext('ADMIN');

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('denies PATIENT accessing DOCTOR or ADMIN endpoints with 403 Forbidden', () => {
    const reflector = new Reflector();
    reflector.getAllAndOverride = (key: any) => (key === ROLES_KEY ? ['DOCTOR', 'ADMIN'] : null);

    const guard = new RolesGuard(reflector);
    const ctx = createMockContext('PATIENT');

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('denies DOCTOR accessing ADMIN verification endpoints with 403 Forbidden', () => {
    const reflector = new Reflector();
    reflector.getAllAndOverride = (key: any) => (key === ROLES_KEY ? ['ADMIN'] : null);

    const guard = new RolesGuard(reflector);
    const ctx = createMockContext('DOCTOR');

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('denies unauthenticated request (no user on request)', () => {
    const reflector = new Reflector();
    reflector.getAllAndOverride = (key: any) => (key === ROLES_KEY ? ['PATIENT'] : null);

    const guard = new RolesGuard(reflector);
    const ctx = createMockContext(undefined);

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
