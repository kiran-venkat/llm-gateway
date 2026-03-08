import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateApiKeyDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsDateString()
  expires_at?: string;
}
