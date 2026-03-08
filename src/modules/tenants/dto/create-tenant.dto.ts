import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateTenantDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'slug must contain only lowercase letters, numbers, and hyphens',
  })
  slug!: string;

  @IsOptional()
  @IsString()
  plan?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  monthly_budget_usd?: number;
}
