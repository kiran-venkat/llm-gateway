import { ExecutionContext } from '@nestjs/common';
import { AuthContext } from '../interfaces/auth-context.interface';
import { resolveTenantContext } from './tenant-context.decorator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_CONTEXT: AuthContext = {
  tenantId: 'tenant-123',
  apiKeyId: 'key-456',
  plan: 'pro',
};

function makeCtx(tenant: AuthContext | undefined): ExecutionContext {
  const req = { tenant };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveTenantContext', () => {
  it('returns the AuthContext when req.tenant is set', () => {
    const ctx = makeCtx(MOCK_CONTEXT);
    expect(resolveTenantContext(undefined, ctx)).toBe(MOCK_CONTEXT);
  });

  it('throws a plain Error when req.tenant is undefined', () => {
    const ctx = makeCtx(undefined);
    expect(() => resolveTenantContext(undefined, ctx)).toThrow(
      'TenantContext used outside of authenticated route',
    );
  });

  it('throws Error (not HttpException) when tenant is missing', () => {
    const ctx = makeCtx(undefined);
    expect(() => resolveTenantContext(undefined, ctx)).toThrow(Error);
    // Must be a plain Error — not an HTTP 4xx — because this is a developer
    // mistake (missing guard), not a client error.
    try {
      resolveTenantContext(undefined, ctx);
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).name).toBe('Error');
    }
  });

  it('returns the exact object reference, not a copy', () => {
    const ctx = makeCtx(MOCK_CONTEXT);
    const result = resolveTenantContext(undefined, ctx);
    expect(result).toBe(MOCK_CONTEXT); // same reference, not toEqual
  });
});
