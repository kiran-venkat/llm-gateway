import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export type ProviderName = 'openai' | 'anthropic' | 'gemini';

export class UpsertProviderConfigDto {
  @ApiProperty({
    example: 'anthropic',
    enum: ['openai', 'anthropic', 'gemini'],
  })
  @IsEnum(['openai', 'anthropic', 'gemini'])
  provider: ProviderName;

  @ApiProperty({
    example: 'sk-ant-api03-...',
    minLength: 10,
    description: 'Provider API key — stored AES-256-GCM encrypted at rest',
  })
  @IsString()
  @MinLength(10)
  api_key: string;

  @ApiProperty({
    example: 60,
    required: false,
    minimum: 1,
    maximum: 10000,
    description: 'Requests-per-minute limit for this tenant/provider pair',
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10000)
  rate_limit_rpm?: number;

  @ApiProperty({
    example: 100000,
    required: false,
    minimum: 1,
    description: 'Tokens-per-minute limit for this tenant/provider pair',
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  rate_limit_tpm?: number;

  @ApiProperty({
    example: 50.0,
    required: false,
    minimum: 0.01,
    description:
      'Monthly spend cap in USD. Requests are blocked once exceeded.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  monthly_spend_limit_usd?: number;
}
