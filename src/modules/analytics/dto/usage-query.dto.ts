import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UsageQueryDto {
  @ApiProperty({ example: '2026-03-01', description: 'Start date (ISO 8601)' })
  @IsDateString()
  start!: string;

  @ApiProperty({ example: '2026-03-31', description: 'End date (ISO 8601)' })
  @IsDateString()
  end!: string;

  @ApiProperty({
    example: 'day',
    enum: ['day', 'hour'],
    required: false,
    default: 'day',
  })
  @IsOptional()
  @IsIn(['day', 'hour'])
  granularity: 'day' | 'hour' = 'day';

  @ApiProperty({ example: 'openai', required: false })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiProperty({ example: 'gpt-4o', required: false })
  @IsOptional()
  @IsString()
  model?: string;
}
