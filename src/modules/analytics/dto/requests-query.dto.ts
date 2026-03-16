import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RequestsQueryDto {
  @ApiProperty({ example: 1, required: false, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiProperty({
    example: 50,
    required: false,
    default: 50,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;

  @ApiProperty({ example: 'openai', required: false })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiProperty({
    example: 'success',
    required: false,
    enum: ['success', 'error', 'cached', 'rate_limited'],
  })
  @IsOptional()
  @IsIn(['success', 'error', 'cached', 'rate_limited'])
  status?: string;

  @ApiProperty({ example: '2026-03-01', required: false })
  @IsOptional()
  @IsDateString()
  start?: string;

  @ApiProperty({ example: '2026-03-31', required: false })
  @IsOptional()
  @IsDateString()
  end?: string;
}
