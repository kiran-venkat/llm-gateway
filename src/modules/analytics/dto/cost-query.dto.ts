import { IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CostQueryDto {
  @ApiProperty({ example: '2026-03-01', description: 'Start date (ISO 8601)' })
  @IsDateString()
  start!: string;

  @ApiProperty({ example: '2026-03-31', description: 'End date (ISO 8601)' })
  @IsDateString()
  end!: string;
}
