export interface RateLimitResult {
  /** Whether the request is allowed to proceed. */
  allowed: boolean;
  /** Remaining slots in the current window after this request. */
  remaining: number;
  /** The configured limit that was checked (used for X-RateLimit-Limit-Rpm). */
  limit: number;
  /** When the oldest in-window entry will fall out (now + window). */
  resetAt: Date;
  /** Only present when allowed = false. Milliseconds until retry is safe. */
  retryAfterMs?: number;
  /** Which limit type triggered this check. */
  limitType: 'rpm' | 'tpm';
}
