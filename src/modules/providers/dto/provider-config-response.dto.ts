export interface ProviderConfigResponseDto {
  id: string;
  provider: string;
  is_active: boolean;
  rate_limit_rpm: number;
  rate_limit_tpm: number;
  monthly_spend_limit_usd: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface ProviderConfigListItemDto extends ProviderConfigResponseDto {
  /** Always '****' — the real key is never returned after write */
  api_key: string;
}
