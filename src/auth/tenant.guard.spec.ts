import { ExecutionContext } from '@nestjs/common';
import { ApiErrorException } from '../common/api-error.exception';
import { TenantGuard } from './tenant.guard';

describe('TenantGuard', () => {
  const guard = new TenantGuard();

  function makeContext(authorization?: string): ExecutionContext {
    const request: Record<string, unknown> = {
      header: (name: string) => (name === 'authorization' ? authorization : undefined),
    };

    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as ExecutionContext;
  }

  function makeToken(payload: Record<string, unknown>): string {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
      'base64url',
    );
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `Bearer ${header}.${body}.`;
  }

  it('attaches tenant context for valid token', () => {
    const ctx = makeContext(makeToken({ sub: 'user-1', tenantId: 'tenant-a' }));
    const request = ctx.switchToHttp().getRequest() as { tenant?: unknown };

    expect(guard.canActivate(ctx)).toBe(true);
    expect(request.tenant).toEqual({ tenantId: 'tenant-a', subject: 'user-1' });
  });

  it('throws when authorization header is missing', () => {
    const ctx = makeContext(undefined);
    expect(() => guard.canActivate(ctx)).toThrow(ApiErrorException);
  });

  it('throws when token payload is malformed', () => {
    const ctx = makeContext('Bearer not-a-jwt');
    expect(() => guard.canActivate(ctx)).toThrow(ApiErrorException);
  });

  it('throws when required claims are missing', () => {
    const ctx = makeContext(makeToken({ sub: 'user-1' }));
    expect(() => guard.canActivate(ctx)).toThrow(ApiErrorException);
  });
});
