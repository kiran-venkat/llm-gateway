import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { TenantContext } from '../../common/decorators/tenant-context.decorator';
import { AuthContext } from '../../common/interfaces/auth-context.interface';
import { ProviderConfigsService } from './provider-configs.service';
import { UpsertProviderConfigDto } from './dto/upsert-provider-config.dto';

@Controller('api/v1/providers')
@UseGuards(AuthGuard)
export class ProviderConfigsController {
  constructor(private readonly service: ProviderConfigsService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async upsert(
    @TenantContext() ctx: AuthContext,
    @Body() dto: UpsertProviderConfigDto,
  ) {
    return this.service.upsert(ctx.tenantId, dto);
  }

  @Get()
  async list(@TenantContext() ctx: AuthContext) {
    return this.service.list(ctx.tenantId);
  }

  @Delete(':provider')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @TenantContext() ctx: AuthContext,
    @Param('provider') provider: string,
  ) {
    await this.service.remove(ctx.tenantId, provider);
  }
}
