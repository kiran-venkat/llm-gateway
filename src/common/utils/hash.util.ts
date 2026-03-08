import { createHash } from 'crypto';

/**
 * Computes a SHA-256 hex digest of a raw API key.
 *
 * Used in two places:
 *  1. ApiKeysService.generate — to produce the keyHash stored in the DB.
 *  2. AuthGuard (T09) — to hash the incoming bearer token before DB lookup.
 *
 * Keeping the algorithm in one place means both sites always agree.
 * If we ever rotate the hashing strategy, there is exactly one change to make.
 */
export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey, 'utf8').digest('hex');
}
