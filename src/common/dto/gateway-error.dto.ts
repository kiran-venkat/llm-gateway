export type GatewayErrorCode =
  | 'rate_limit'
  | 'invalid_model'
  | 'auth_error'
  | 'provider_unavailable'
  | 'context_too_long'
  | 'unknown';

export interface GatewayError {
  code: GatewayErrorCode;
  message: string;
  provider: string;
  /**
   * true for rate_limit and provider_unavailable.
   * NOTE: the gateway does NOT currently retry failed provider calls — this
   * field informs the *client* whether it is safe to retry. A retry loop with
   * circuit-breaker + jitter is planned for Phase 4. Do not implement naive
   * retries without both, to avoid thundering-herd against the provider.
   */
  retryable: boolean;
  /** HTTP status to return to the client */
  statusCode: number;
}
