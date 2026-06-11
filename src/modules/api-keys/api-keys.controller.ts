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
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { TenantContext } from '../../common/decorators/tenant-context.decorator';
import { AuthContext } from '../../common/interfaces/auth-context.interface';
import { ApiKeysService } from './api-keys.service';
import { AdminCreateApiKeyDto } from './dto/admin-create-api-key.dto';

/**
 * Route guard strategy:
 *   POST   /api/v1/keys      → AdminGuard  (operator creates keys for tenants)
 *   GET    /api/v1/keys      → AuthGuard   (tenant lists their own keys)
 *   DELETE /api/v1/keys/:id  → AuthGuard   (tenant revokes their own key)
 *
 * POST requires admin because key creation bootstraps tenant access — a tenant
 * can't create their own first key (they'd need a key to authenticate the
 * request). Admin creates the first key; the tenant uses it for everything else.
 */
@ApiTags('API Keys')
@ApiBearerAuth('api-key')
@Controller('api/v1/keys')
export class ApiKeysController {
  constructor(private readonly service: ApiKeysService) {}

  @ApiOperation({
    summary: 'List API keys',
    description:
      'Returns all non-revoked keys for the authenticated tenant. Raw key values are never returned.',
  })
  @ApiResponse({
    status: 200,
    description:
      'List of API keys (hashed — raw value never returned after creation)',
  })
  @UseGuards(AuthGuard)
  @Get()
  list(@TenantContext() ctx: AuthContext) {
    return this.service.listForTenant(ctx.tenantId);
  }

  @ApiOperation({
    summary: 'Create API key (admin)',
    description:
      'Generates a new API key for a tenant. The raw key value is returned ONCE ' +
      'in this response only — it cannot be retrieved again. Requires admin secret.',
  })
  @ApiBody({ type: AdminCreateApiKeyDto })
  @ApiResponse({
    status: 201,
    description: 'Key created. Raw value in `key` field — save it now.',
  })
  @ApiResponse({ status: 401, description: 'Admin authorization required' })
  @ApiResponse({ status: 403, description: 'Invalid admin secret' })
  @UseGuards(AdminGuard)
  @Post()
  generate(@Body() dto: AdminCreateApiKeyDto) {
    return this.service.generate(dto.tenant_id, dto);
  }

  @ApiOperation({
    summary: 'Revoke API key',
    description:
      'Permanently revokes the key. In-flight requests using this key will receive 401 after Redis TTL expires.',
  })
  @ApiParam({ name: 'id', description: 'API key UUID' })
  @ApiResponse({ status: 204, description: 'Key revoked' })
  @ApiResponse({ status: 404, description: 'Key not found' })
  @UseGuards(AuthGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @TenantContext() ctx: AuthContext,
    @Param('id') id: string,
  ): Promise<void> {
    await this.service.revoke(ctx.tenantId, id);
  }
}
