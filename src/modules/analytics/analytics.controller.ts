import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard';
import { TenantContext } from '../../common/decorators/tenant-context.decorator';
import { AuthContext } from '../../common/interfaces/auth-context.interface';
import { AnalyticsService } from './analytics.service';
import { CostQueryDto } from './dto/cost-query.dto';
import { RequestsQueryDto } from './dto/requests-query.dto';
import { UsageQueryDto } from './dto/usage-query.dto';

@ApiTags('Analytics')
@ApiBearerAuth('api-key')
@Controller('api/v1/analytics')
@UseGuards(AuthGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @ApiOperation({
    summary: 'Cache statistics',
    description:
      'Hit rate, miss count, and estimated cost savings from the response cache',
  })
  @ApiResponse({
    status: 200,
    description: 'Cache stats for the authenticated tenant',
  })
  @Get('cache')
  async getCacheStats(
    @TenantContext() ctx: AuthContext,
  ): Promise<ReturnType<AnalyticsService['getCacheStats']>> {
    return this.analyticsService.getCacheStats(ctx.tenantId);
  }

  @ApiOperation({
    summary: 'Usage time series',
    description: 'Token usage and request counts grouped by day or hour',
  })
  @ApiQuery({
    name: 'start',
    description: 'Start date (ISO 8601)',
    example: '2026-03-01',
  })
  @ApiQuery({
    name: 'end',
    description: 'End date (ISO 8601)',
    example: '2026-03-31',
  })
  @ApiQuery({
    name: 'granularity',
    required: false,
    enum: ['day', 'hour'],
    example: 'day',
  })
  @ApiQuery({ name: 'provider', required: false, example: 'openai' })
  @ApiQuery({ name: 'model', required: false, example: 'gpt-4o' })
  @ApiResponse({ status: 200, description: 'Time-series usage data' })
  @Get('usage')
  async getUsageTimeSeries(
    @TenantContext() ctx: AuthContext,
    @Query() query: UsageQueryDto,
  ): Promise<ReturnType<AnalyticsService['getUsageTimeSeries']>> {
    return this.analyticsService.getUsageTimeSeries(ctx.tenantId, query);
  }

  @ApiOperation({
    summary: 'Request log',
    description: 'Paginated log of all gateway requests with filters',
  })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  @ApiQuery({ name: 'provider', required: false, example: 'anthropic' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['success', 'error', 'cached', 'rate_limited'],
  })
  @ApiQuery({ name: 'start', required: false, example: '2026-03-01' })
  @ApiQuery({ name: 'end', required: false, example: '2026-03-31' })
  @ApiResponse({ status: 200, description: 'Paginated request log' })
  @Get('requests')
  async getRequestLog(
    @TenantContext() ctx: AuthContext,
    @Query() query: RequestsQueryDto,
  ): Promise<ReturnType<AnalyticsService['getRequestLog']>> {
    return this.analyticsService.getRequestLog(ctx.tenantId, query);
  }

  @ApiOperation({
    summary: 'Cost breakdown',
    description: 'Total spend and per-provider cost breakdown for a date range',
  })
  @ApiQuery({
    name: 'start',
    description: 'Start date (ISO 8601)',
    example: '2026-03-01',
  })
  @ApiQuery({
    name: 'end',
    description: 'End date (ISO 8601)',
    example: '2026-03-31',
  })
  @ApiResponse({ status: 200, description: 'Cost breakdown by provider' })
  @Get('cost')
  async getCostBreakdown(
    @TenantContext() ctx: AuthContext,
    @Query() query: CostQueryDto,
  ): Promise<ReturnType<AnalyticsService['getCostBreakdown']>> {
    return this.analyticsService.getCostBreakdown(ctx.tenantId, query);
  }
}
