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
import { TenantContext } from '../../common/decorators/tenant-context.decorator';
import { AuthContext } from '../../common/interfaces/auth-context.interface';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';

@ApiTags('API Keys')
@ApiBearerAuth('api-key')
@Controller('api/v1/keys')
@UseGuards(AuthGuard)
export class ApiKeysController {
  constructor(private readonly service: ApiKeysService) {}

  @ApiOperation({ summary: 'List API keys', description: 'Returns all non-revoked keys for the tenant. Raw key values are never returned.' })
  @ApiResponse({ status: 200, description: 'List of API keys (hashed — raw value never returned after creation)' })
  @Get()
  list(@TenantContext() ctx: AuthContext) {
    return this.service.listForTenant(ctx.tenantId);
  }

  @ApiOperation({
    summary: 'Create API key',
    description: 'Generates a new API key. The raw key value is returned ONCE in this response only — it cannot be retrieved again.',
  })
  @ApiBody({ type: CreateApiKeyDto })
  @ApiResponse({ status: 201, description: 'Key created. Raw value in `key` field — save it now.' })
  @Post()
  generate(@TenantContext() ctx: AuthContext, @Body() dto: CreateApiKeyDto) {
    return this.service.generate(ctx.tenantId, dto);
  }

  @ApiOperation({ summary: 'Revoke API key', description: 'Permanently revokes the key. In-flight requests using this key will receive 401 after Redis TTL expires.' })
  @ApiParam({ name: 'id', description: 'API key UUID' })
  @ApiResponse({ status: 204, description: 'Key revoked' })
  @ApiResponse({ status: 404, description: 'Key not found' })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @TenantContext() ctx: AuthContext,
    @Param('id') id: string,
  ): Promise<void> {
    await this.service.revoke(ctx.tenantId, id);
  }
}
