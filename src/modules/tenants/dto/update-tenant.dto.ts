import {
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

// Manual all-optional version of CreateTenantDto.
// @nestjs/mapped-types is not installed (peer conflict with class-validator 0.15).
export class UpdateTenantDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'slug must contain only lowercase letters, numbers, and hyphens',
  })
  slug?: string;

  @IsOptional()
  @IsString()
  plan?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  monthly_budget_usd?: number;
}
