import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export type ProviderName = 'openai' | 'anthropic' | 'gemini';

export class UpsertProviderConfigDto {
  @IsEnum(['openai', 'anthropic', 'gemini'])
  provider: ProviderName;

  @IsString()
  @MinLength(10)
  api_key: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10000)
  rate_limit_rpm?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  rate_limit_tpm?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  monthly_spend_limit_usd?: number;
}
