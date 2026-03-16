import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { TenantContext } from '../../common/decorators/tenant-context.decorator';
import { AuthContext } from '../../common/interfaces/auth-context.interface';
import { AnalyticsService } from './analytics.service';
import { UsageQueryDto } from './dto/usage-query.dto';

@Controller('api/v1/analytics')
@UseGuards(AuthGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('cache')
  async getCacheStats(
    @TenantContext() ctx: AuthContext,
  ): Promise<ReturnType<AnalyticsService['getCacheStats']>> {
    return this.analyticsService.getCacheStats(ctx.tenantId);
  }

  @Get('usage')
  async getUsageTimeSeries(
    @TenantContext() ctx: AuthContext,
    @Query() query: UsageQueryDto,
  ): Promise<ReturnType<AnalyticsService['getUsageTimeSeries']>> {
    return this.analyticsService.getUsageTimeSeries(ctx.tenantId, query);
  }
}
