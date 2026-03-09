/** Redis key prefix for auth context entries, keyed by SHA-256 hash of the raw API key. */
export const AUTH_CACHE_PREFIX = 'auth:hash:';

/** Auth cache TTL in seconds (5 minutes). Revoked keys stop working within this window. */
export const AUTH_CACHE_TTL_SECONDS = 300;
