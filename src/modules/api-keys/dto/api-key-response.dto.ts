/**
 * Returned once after key generation.
 * `key` is the raw value — it is never stored and will never be shown again.
 */
export interface ApiKeyResponseDto {
  id: string;
  key: string;
  key_prefix: string;
  name: string | null;
  created_at: Date;
}

/**
 * Safe list item — no raw key, no hash.
 * Only metadata the tenant needs to manage their keys.
 */
export interface ApiKeyListItemDto {
  id: string;
  key_prefix: string;
  name: string | null;
  is_active: boolean;
  last_used_at: Date | null;
  expires_at: Date | null;
  created_at: Date;
}
