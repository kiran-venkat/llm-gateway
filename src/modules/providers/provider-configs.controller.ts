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
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard';
import { TenantContext } from '../../common/decorators/tenant-context.decorator';
import { AuthContext } from '../../common/interfaces/auth-context.interface';
import { ProviderConfigsService } from './provider-configs.service';
import { ProviderStatusService } from './provider-status.service';
import { UpsertProviderConfigDto } from './dto/upsert-provider-config.dto';

@ApiTags('Providers')
@ApiBearerAuth('api-key')
@Controller('api/v1/providers')
@UseGuards(AuthGuard)
export class ProviderConfigsController {
  constructor(
    private readonly service: ProviderConfigsService,
    private readonly statusService: ProviderStatusService,
  ) {}

  @ApiOperation({
    summary: 'Add or update provider',
    description: 'Upserts provider credentials and rate limits. The API key is encrypted with AES-256-GCM at rest.',
  })
  @ApiBody({ type: UpsertProviderConfigDto })
  @ApiResponse({ status: 200, description: 'Provider config saved' })
  @Post()
  @HttpCode(HttpStatus.OK)
  async upsert(
    @TenantContext() ctx: AuthContext,
    @Body() dto: UpsertProviderConfigDto,
  ) {
    return this.service.upsert(ctx.tenantId, dto);
  }

  @ApiOperation({ summary: 'List providers', description: 'Returns all configured providers. API keys are never returned.' })
  @ApiResponse({ status: 200, description: 'List of configured providers' })
  @Get()
  async list(@TenantContext() ctx: AuthContext) {
    return this.service.list(ctx.tenantId);
  }

  @ApiOperation({ summary: 'Provider status', description: 'Probes each configured provider and returns latency/status. Results are cached 30s.' })
  @ApiResponse({ status: 200, description: 'Per-provider status: active | degraded | down' })
  @Get('status')
  async status(@TenantContext() ctx: AuthContext) {
    return this.statusService.getStatus(ctx.tenantId);
  }

  @ApiOperation({ summary: 'Remove provider', description: 'Deletes the provider config and its encrypted API key.' })
  @ApiParam({ name: 'provider', enum: ['openai', 'anthropic', 'gemini'] })
  @ApiResponse({ status: 204, description: 'Provider removed' })
  @ApiResponse({ status: 404, description: 'Provider not found' })
  @Delete(':provider')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @TenantContext() ctx: AuthContext,
    @Param('provider') provider: string,
  ) {
    await this.service.remove(ctx.tenantId, provider);
  }
}
