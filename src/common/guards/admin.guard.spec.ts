import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AdminGuard } from './admin.guard';
import { AppConfigService } from '../../config/config.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN_SECRET = 'test-admin-secret-abc123';

function makeGuard(): AdminGuard {
  const mockConfig = {
    getAdminSecret: () => ADMIN_SECRET,
  } as unknown as AppConfigService;
  return new AdminGuard(mockConfig);
}

function makeCtx(authHeader?: string): ExecutionContext {
  const req = {
    headers: authHeader ? { authorization: authHeader } : {},
  } as unknown as Request;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AdminGuard', () => {
  let guard: AdminGuard;

  beforeEach(() => {
    guard = makeGuard();
  });

  // ── 1. Missing header → 401 ────────────────────────────────────────────────

  it('throws UnauthorizedException (401) when Authorization header is absent', () => {
    expect(() => guard.canActivate(makeCtx())).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException (401) when header is not Bearer scheme', () => {
    expect(() => guard.canActivate(makeCtx('Basic dXNlcjpwYXNz'))).toThrow(
      UnauthorizedException,
    );
  });

  it('throws UnauthorizedException (401) when Bearer token is empty', () => {
    expect(() => guard.canActivate(makeCtx('Bearer '))).toThrow(
      UnauthorizedException,
    );
  });

  // ── 2. Wrong secret → 403 ─────────────────────────────────────────────────

  it('throws ForbiddenException (403) when Bearer token is present but wrong', () => {
    expect(() => guard.canActivate(makeCtx('Bearer wrong-secret'))).toThrow(
      ForbiddenException,
    );
  });

  it('throws ForbiddenException (403) when secret is close but not exact', () => {
    expect(() => guard.canActivate(makeCtx(`Bearer ${ADMIN_SECRET}x`))).toThrow(
      ForbiddenException,
    );
  });

  // ── 3. Correct secret → passes ────────────────────────────────────────────

  it('returns true when Bearer token matches ADMIN_SECRET', () => {
    const result = guard.canActivate(makeCtx(`Bearer ${ADMIN_SECRET}`));
    expect(result).toBe(true);
  });

  // ── 4. Independence from AuthGuard ────────────────────────────────────────

  it('does not set req.tenant (never touches the AuthGuard contract)', () => {
    const req = {
      headers: { authorization: `Bearer ${ADMIN_SECRET}` },
    } as unknown as Request;
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;

    guard.canActivate(ctx);
    // req.tenant must remain undefined — AdminGuard must not interfere with
    // the AuthGuard / @TenantContext() contract.
    expect(
      (req as unknown as Record<string, unknown>)['tenant'],
    ).toBeUndefined();
  });
});
