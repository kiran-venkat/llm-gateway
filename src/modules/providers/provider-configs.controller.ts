import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { TenantContext } from '../../common/decorators/tenant-context.decorator';
import { AuthContext } from '../../common/interfaces/auth-context.interface';
import { ProviderConfigsService } from './provider-configs.service';
import { ProviderStatusService } from './provider-status.service';
import { AdminUpsertProviderConfigDto } from './dto/admin-upsert-provider-config.dto';

/**
 * Route guard strategy:
 *   POST   /api/v1/providers            → AdminGuard  (operator configures providers for tenants)
 *   GET    /api/v1/providers            → AuthGuard   (tenant reads their own configs)
 *   GET    /api/v1/providers/status     → AuthGuard   (tenant checks their own provider health)
 *   DELETE /api/v1/providers/:provider  → AdminGuard  (operator removes provider config)
 *
 * Admin endpoints do NOT use @TenantContext() — the tenant ID comes from the
 * request body/query. Tenant endpoints use @TenantContext() as usual.
 */
@ApiTags('Providers')
@ApiBearerAuth('api-key')
@Controller('api/v1/providers')
export class ProviderConfigsController {
  constructor(
    private readonly service: ProviderConfigsService,
    private readonly statusService: ProviderStatusService,
  ) {}

  @ApiOperation({
    summary: 'Add or update provider (admin)',
    description:
      'Upserts provider credentials and rate limits for a tenant. ' +
      'The API key is encrypted with AES-256-GCM at rest. Requires admin secret.',
  })
  @ApiBody({ type: AdminUpsertProviderConfigDto })
  @ApiResponse({ status: 200, description: 'Provider config saved' })
  @ApiResponse({ status: 401, description: 'Admin authorization required' })
  @ApiResponse({ status: 403, description: 'Invalid admin secret' })
  @UseGuards(AdminGuard)
  @Post()
  @HttpCode(HttpStatus.OK)
  async upsert(@Body() dto: AdminUpsertProviderConfigDto) {
    return this.service.upsert(dto.tenant_id, dto);
  }

  @ApiOperation({
    summary: 'List providers',
    description:
      'Returns all configured providers for the authenticated tenant. API keys are never returned.',
  })
  @ApiResponse({ status: 200, description: 'List of configured providers' })
  @UseGuards(AuthGuard)
  @Get()
  async list(@TenantContext() ctx: AuthContext) {
    return this.service.list(ctx.tenantId);
  }

  @ApiOperation({
    summary: 'Provider status',
    description:
      'Probes each configured provider and returns latency/status. Results are cached 30s.',
  })
  @ApiResponse({
    status: 200,
    description: 'Per-provider status: active | degraded | down',
  })
  @UseGuards(AuthGuard)
  @Get('status')
  async status(@TenantContext() ctx: AuthContext) {
    return this.statusService.getStatus(ctx.tenantId);
  }

  @ApiOperation({
    summary: 'Remove provider (admin)',
    description:
      'Deletes the provider config and its encrypted API key for a tenant. Requires admin secret.',
  })
  @ApiParam({ name: 'provider', enum: ['openai', 'anthropic', 'gemini'] })
  @ApiQuery({
    name: 'tenant_id',
    description: 'UUID of the tenant',
    required: true,
  })
  @ApiResponse({ status: 204, description: 'Provider removed' })
  @ApiResponse({ status: 404, description: 'Provider not found' })
  @ApiResponse({ status: 401, description: 'Admin authorization required' })
  @ApiResponse({ status: 403, description: 'Invalid admin secret' })
  @UseGuards(AdminGuard)
  @Delete(':provider')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('provider') provider: string,
    @Query('tenant_id', ParseUUIDPipe) tenantId: string,
  ) {
    await this.service.remove(tenantId, provider);
  }
}
