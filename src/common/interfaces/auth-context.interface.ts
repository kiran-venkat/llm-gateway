import { RateLimitResult } from './rate-limit-result.interface';

/**
 * Resolved and validated identity attached to every authenticated request.
 * Written by AuthGuard onto request.tenant; read by downstream
 * controllers via the @CurrentTenant() decorator (wired in a later task).
 */
export interface AuthContext {
  tenantId: string;
  apiKeyId: string;
  plan: string;
}

// Augment Express's Request so that req.tenant is typed and known to TypeScript.
// Without this, strict mode rejects req['tenant'] = ... on the standard Request type.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tenant?: AuthContext;
      /** Set by RequestIdMiddleware before any guard or handler runs. */
      requestId: string;
      /** Set by RateLimitGuard after RPM check passes; used for response headers in T27. */
      rateLimit?: RateLimitResult;
    }
  }
}
