import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { UpsertProviderConfigDto } from './upsert-provider-config.dto';

export class AdminUpsertProviderConfigDto extends UpsertProviderConfigDto {
  @ApiProperty({
    example: '32142ec5-691a-4ab2-9797-cdb8e8fbff58',
    description: 'UUID of the tenant to configure this provider for.',
  })
  @IsUUID()
  tenant_id: string;
}
