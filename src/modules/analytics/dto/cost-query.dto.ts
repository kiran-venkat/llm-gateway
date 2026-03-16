import { IsDateString } from 'class-validator';

export class CostQueryDto {
  @IsDateString()
  start!: string;

  @IsDateString()
  end!: string;
}
