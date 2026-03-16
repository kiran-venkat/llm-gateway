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
   * GatewayService retries once (500ms delay) on retryable errors before
   * propagating. Non-retryable errors (auth, invalid_model, context_too_long)
   * are never retried.
   */
  retryable: boolean;
  /** HTTP status to return to the client */
  statusCode: number;
}

export function isGatewayError(err: unknown): err is GatewayError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    'statusCode' in err &&
    'retryable' in err
  );
}
