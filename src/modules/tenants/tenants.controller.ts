import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
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
import { AdminGuard } from '../../common/guards/admin.guard';
import { TenantsService } from './tenants.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';

/**
 * Tenant management endpoints — admin-only.
 *
 * All routes require Authorization: Bearer <ADMIN_SECRET>.
 * These endpoints do NOT use @TenantContext() — there is no tenant API key
 * in play here. Never add AuthGuard to this controller.
 */
@ApiTags('Tenants')
@ApiBearerAuth('api-key')
@Controller('api/v1/tenants')
@UseGuards(AdminGuard)
export class TenantsController {
  constructor(private readonly service: TenantsService) {}

  @ApiOperation({
    summary: 'Create tenant',
    description: 'Creates a new tenant. Requires admin secret.',
  })
  @ApiBody({ type: CreateTenantDto })
  @ApiResponse({ status: 201, description: 'Tenant created' })
  @ApiResponse({ status: 400, description: 'Invalid slug or duplicate' })
  @ApiResponse({ status: 401, description: 'Admin authorization required' })
  @ApiResponse({ status: 403, description: 'Invalid admin secret' })
  @Post()
  async create(@Body() dto: CreateTenantDto) {
    return this.service.create(dto);
  }

  @ApiOperation({
    summary: 'Get tenant by ID',
    description: 'Returns tenant details. Requires admin secret.',
  })
  @ApiParam({ name: 'id', description: 'Tenant UUID' })
  @ApiResponse({ status: 200, description: 'Tenant found' })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @ApiOperation({
    summary: 'Update tenant',
    description:
      'Updates tenant name, slug, plan, or budget. Requires admin secret.',
  })
  @ApiParam({ name: 'id', description: 'Tenant UUID' })
  @ApiBody({ type: UpdateTenantDto })
  @ApiResponse({ status: 200, description: 'Tenant updated' })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    return this.service.update(id, dto);
  }
}
