import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateApiKeyDto {
  @ApiProperty({ example: 'Production key', required: false, maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiProperty({
    example: '2027-01-01T00:00:00.000Z',
    required: false,
    description: 'ISO 8601 expiry date. Omit for a non-expiring key.',
  })
  @IsOptional()
  @IsDateString()
  expires_at?: string;
}
