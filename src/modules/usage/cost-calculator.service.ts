import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

interface PricingEntry {
  inputCostPer1kTokens: number;
  outputCostPer1kTokens: number;
}

@Injectable()
export class CostCalculatorService implements OnModuleInit {
  private readonly logger = new Logger(CostCalculatorService.name);
  private readonly pricingMap = new Map<string, PricingEntry>();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.refreshPricing();
  }

  async refreshPricing(): Promise<void> {
    const rows = await this.prisma.modelPricing.findMany({
      where: { validTo: null },
    });

    this.pricingMap.clear();
    for (const row of rows) {
      const key = `${row.provider}:${row.model}`;
      this.pricingMap.set(key, {
        inputCostPer1kTokens: Number(row.inputCostPer1kTokens),
        outputCostPer1kTokens: Number(row.outputCostPer1kTokens),
      });
    }

    this.logger.log(`Pricing cache loaded: ${this.pricingMap.size} models`);
  }

  async calculateCost(
    provider: string,
    model: string,
    promptTokens: number,
    completionTokens: number,
  ): Promise<number> {
    const key = `${provider}:${model}`;
    const pricing = this.pricingMap.get(key);

    if (!pricing) {
      this.logger.warn(
        `No pricing found for ${key} — cost recorded as 0. ` +
          `Run refreshPricing() after seeding new models.`,
      );
      return 0;
    }

    return (
      (promptTokens / 1000) * pricing.inputCostPer1kTokens +
      (completionTokens / 1000) * pricing.outputCostPer1kTokens
    );
  }
}
