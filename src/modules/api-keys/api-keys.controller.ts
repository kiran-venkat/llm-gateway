import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { TenantContext } from '../../common/decorators/tenant-context.decorator';
import { AuthContext } from '../../common/interfaces/auth-context.interface';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';

@Controller('api/v1/keys')
@UseGuards(AuthGuard)
export class ApiKeysController {
  constructor(private readonly service: ApiKeysService) {}

  @Get()
  list(@TenantContext() ctx: AuthContext) {
    return this.service.listForTenant(ctx.tenantId);
  }

  @Post()
  generate(@TenantContext() ctx: AuthContext, @Body() dto: CreateApiKeyDto) {
    return this.service.generate(ctx.tenantId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @TenantContext() ctx: AuthContext,
    @Param('id') id: string,
  ): Promise<void> {
    await this.service.revoke(ctx.tenantId, id);
  }
}
