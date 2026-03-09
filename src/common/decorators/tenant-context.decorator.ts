import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { AuthContext } from '../interfaces/auth-context.interface';

/**
 * Inner factory extracted so it can be unit-tested directly without
 * going through NestJS's decorator machinery.
 */
export function resolveTenantContext(
  _data: unknown,
  ctx: ExecutionContext,
): AuthContext {
  const req = ctx.switchToHttp().getRequest<Request>();
  if (!req.tenant) {
    // Developer error — not an HTTP error. The route should be protected by
    // AuthGuard. If this throws, a guard is missing, not a client mistake.
    throw new Error('TenantContext used outside of authenticated route');
  }
  return req.tenant;
}

/**
 * Param decorator that extracts the resolved AuthContext from the request.
 *
 * Usage:
 *   async someEndpoint(@TenantContext() tenant: AuthContext) { ... }
 *
 * Must only be used on routes protected by AuthGuard. If the guard hasn't
 * run (or is missing), this throws a plain Error — not an HttpException —
 * because the bug is in the server code, not the client request.
 */
export const TenantContext = createParamDecorator(resolveTenantContext);
