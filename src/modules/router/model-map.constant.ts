/**
 * Exact model-name → provider mapping.
 * Used as Step 3 in RouterService.resolve() — fast O(1) lookup for known models.
 */
export const MODEL_PROVIDER_MAP: Record<string, string> = {
  // OpenAI
  'gpt-4o': 'openai',
  'gpt-4o-mini': 'openai',
  'gpt-4-turbo': 'openai',
  o1: 'openai',
  'o1-mini': 'openai',
  // Anthropic
  'claude-3-5-sonnet-20241022': 'anthropic',
  'claude-3-5-haiku-20241022': 'anthropic',
  'claude-haiku-4-5-20251001': 'anthropic',
  'claude-3-opus-20240229': 'anthropic',
  // Gemini
  'gemini-1.5-pro': 'gemini',
  'gemini-1.5-flash': 'gemini',
  'gemini-2.0-flash': 'gemini',
  'gemini-2.0-flash-001': 'gemini',
};

/**
 * Prefix-based fallback for unknown model versions.
 * Used as Step 4 in RouterService.resolve() — handles future model releases
 * (e.g. 'gpt-5') without needing to update this map.
 * Evaluated in order — first match wins.
 *
 * ORDER MATTERS: more-specific prefixes must precede less-specific ones.
 * 'o1' is listed after 'gpt-' but there is no ambiguity today. If adding
 * new prefixes within the same provider family, put the longer/stricter
 * prefix first to prevent it from being shadowed by a shorter one.
 */
export const MODEL_PREFIX_MAP: Array<{ prefix: string; provider: string }> = [
  { prefix: 'gpt-', provider: 'openai' },
  { prefix: 'o1', provider: 'openai' },
  { prefix: 'claude-', provider: 'anthropic' },
  { prefix: 'gemini-', provider: 'gemini' },
];
