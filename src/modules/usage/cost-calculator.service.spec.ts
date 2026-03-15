import { CostCalculatorService } from './cost-calculator.service';
import { PrismaService } from '../../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HAIKU_ROW = {
  id: 'price-1',
  provider: 'anthropic',
  model: 'claude-haiku-4-5-20251001',
  inputCostPer1kTokens: 0.0008,
  outputCostPer1kTokens: 0.004,
  validFrom: new Date('2024-01-01'),
  validTo: null,
};

const GPT4O_ROW = {
  id: 'price-2',
  provider: 'openai',
  model: 'gpt-4o',
  inputCostPer1kTokens: 0.0025,
  outputCostPer1kTokens: 0.01,
  validFrom: new Date('2024-01-01'),
  validTo: null,
};

function makePrisma(
  rows: typeof HAIKU_ROW[] = [HAIKU_ROW, GPT4O_ROW],
): jest.Mocked<PrismaService> {
  return {
    modelPricing: {
      findMany: jest.fn().mockResolvedValue(rows),
    },
  } as unknown as jest.Mocked<PrismaService>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CostCalculatorService', () => {
  let service: CostCalculatorService;
  let prisma: jest.Mocked<PrismaService>;

  describe('calculateCost', () => {
    beforeEach(async () => {
      prisma = makePrisma();
      service = new CostCalculatorService(prisma);
      await service.onModuleInit();
    });

    it('returns correct cost for known model (haiku, 16 prompt + 6 completion)', async () => {
      // (16/1000 * 0.0008) + (6/1000 * 0.004)
      // = 0.0000128 + 0.000024
      // = 0.0000368
      const cost = await service.calculateCost(
        'anthropic',
        'claude-haiku-4-5-20251001',
        16,
        6,
      );
      expect(cost).toBeCloseTo(0.0000368, 10);
    });

    it('returns correct cost for openai gpt-4o', async () => {
      // (100/1000 * 0.0025) + (50/1000 * 0.01) = 0.00025 + 0.0005 = 0.00075
      const cost = await service.calculateCost('openai', 'gpt-4o', 100, 50);
      expect(cost).toBeCloseTo(0.00075, 10);
    });

    it('returns 0 and logs a warning for an unknown model', async () => {
      const warnSpy = jest
        .spyOn((service as unknown as { logger: { warn: jest.Mock } }).logger, 'warn')
        .mockImplementation(() => undefined);

      const cost = await service.calculateCost(
        'openai',
        'does-not-exist-model',
        100,
        50,
      );

      expect(cost).toBe(0);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('openai:does-not-exist-model'),
      );
    });

    it('returns 0 when both token counts are 0', async () => {
      const cost = await service.calculateCost(
        'anthropic',
        'claude-haiku-4-5-20251001',
        0,
        0,
      );
      expect(cost).toBe(0);
    });

    it('reads from Map after init — no additional DB call during calculateCost', async () => {
      // findMany was called once during onModuleInit
      expect(prisma.modelPricing.findMany).toHaveBeenCalledTimes(1);

      await service.calculateCost(
        'anthropic',
        'claude-haiku-4-5-20251001',
        50,
        20,
      );

      // Still only one call — Map was used, not DB
      expect(prisma.modelPricing.findMany).toHaveBeenCalledTimes(1);
    });

    it('two calls to same model trigger only one DB load (at init)', async () => {
      await service.calculateCost(
        'anthropic',
        'claude-haiku-4-5-20251001',
        10,
        5,
      );
      await service.calculateCost(
        'anthropic',
        'claude-haiku-4-5-20251001',
        20,
        10,
      );

      expect(prisma.modelPricing.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('refreshPricing', () => {
    it('reloads the Map from DB when called', async () => {
      prisma = makePrisma([HAIKU_ROW]);
      service = new CostCalculatorService(prisma);
      await service.onModuleInit();

      // Haiku is known, gpt-4o is not yet loaded
      expect(
        await service.calculateCost('openai', 'gpt-4o', 10, 5),
      ).toBe(0);

      // Reload with both rows
      (prisma.modelPricing.findMany as jest.Mock).mockResolvedValue([
        HAIKU_ROW,
        GPT4O_ROW,
      ]);
      await service.refreshPricing();

      // gpt-4o now available
      const cost = await service.calculateCost('openai', 'gpt-4o', 100, 50);
      expect(cost).toBeCloseTo(0.00075, 10);
    });

    it('clears stale entries when called', async () => {
      prisma = makePrisma([HAIKU_ROW, GPT4O_ROW]);
      service = new CostCalculatorService(prisma);
      await service.onModuleInit();

      // Now simulate pricing removed (haiku no longer active)
      (prisma.modelPricing.findMany as jest.Mock).mockResolvedValue([
        GPT4O_ROW,
      ]);
      await service.refreshPricing();

      const cost = await service.calculateCost(
        'anthropic',
        'claude-haiku-4-5-20251001',
        16,
        6,
      );
      expect(cost).toBe(0);
    });
  });
});
