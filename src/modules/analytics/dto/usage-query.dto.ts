import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

export class UsageQueryDto {
  @IsDateString()
  start!: string;

  @IsDateString()
  end!: string;

  @IsOptional()
  @IsIn(['day', 'hour'])
  granularity: 'day' | 'hour' = 'day';

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsString()
  model?: string;
}
