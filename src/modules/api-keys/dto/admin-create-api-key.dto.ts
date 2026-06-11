import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CreateApiKeyDto } from './create-api-key.dto';

export class AdminCreateApiKeyDto extends CreateApiKeyDto {
  @ApiProperty({
    example: '32142ec5-691a-4ab2-9797-cdb8e8fbff58',
    description: 'UUID of the tenant to create this key for.',
  })
  @IsUUID()
  tenant_id: string;
}
