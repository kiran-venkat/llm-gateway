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
  /** true for rate_limit and provider_unavailable */
  retryable: boolean;
  /** HTTP status to return to the client */
  statusCode: number;
}
