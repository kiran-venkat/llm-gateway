import { RoutingRule, ProviderConfig } from '@prisma/client';
import { randomUUID } from 'crypto';
import { RouterService, RouterRequest } from './router.service';
import { RouterRepository } from './router.repository';
import { ProviderConfigsRepository } from '../providers/provider-configs.repository';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(
  model: string,
  overrides: Partial<RouterRequest> = {},
): RouterRequest {
  return {
    model,
    messages: [{ role: 'user', content: 'Hi' }],
    tenantId: 'tenant-1',
    ...overrides,
  };
}

function makeRule(
  overrides: Partial<RoutingRule> & {
    targetProvider: string;
    targetModel: string;
  },
): RoutingRule {
  return {
    id: randomUUID(),
    tenantId: 'tenant-1',
    name: 'test-rule',
    priority: 100,
    conditions: {},
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as RoutingRule;
}

function makeProviderConfig(provider: string): ProviderConfig {
  return {
    id: randomUUID(),
    tenantId: 'tenant-1',
    provider,
    apiKeyEncrypted: 'enc',
    apiKeyIv: 'iv',
    isActive: true,
    rateLimitRpm: 60,
    rateLimitTpm: 100000,
    monthlySpendLimitUsd: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as ProviderConfig;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('RouterService', () => {
  let service: RouterService;
  let mockRouterRepo: jest.Mocked<Pick<RouterRepository, 'findRulesForTenant'>>;
  let mockConfigsRepo: jest.Mocked<
    Pick<ProviderConfigsRepository, 'findActiveByTenant'>
  >;

  beforeEach(() => {
    mockRouterRepo = { findRulesForTenant: jest.fn().mockResolvedValue([]) };
    mockConfigsRepo = { findActiveByTenant: jest.fn().mockResolvedValue([]) };

    service = new RouterService(
      mockRouterRepo as unknown as RouterRepository,
      mockConfigsRepo as unknown as ProviderConfigsRepository,
    );
  });

  // ── Step 1: x-provider override ──────────────────────────────────────────

  it('x-provider override returns immediately without loading rules', async () => {
    const result = await service.resolve(
      makeRequest('gpt-4o', { xProvider: 'anthropic' }),
      'tenant-1',
    );

    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('gpt-4o');
    expect(mockRouterRepo.findRulesForTenant).not.toHaveBeenCalled();
  });

  // ── Step 2: routing rules ────────────────────────────────────────────────

  it('matching rule returns targetProvider and targetModel', async () => {
    const rule = makeRule({
      conditions: { model_pattern: 'gpt-4*' },
      targetProvider: 'openai',
      targetModel: 'gpt-4o',
    });
    mockRouterRepo.findRulesForTenant.mockResolvedValue([rule]);

    const result = await service.resolve(makeRequest('gpt-4o'), 'tenant-1');

    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-4o');
    expect(result.ruleId).toBe(rule.id);
  });

  it('higher-priority rule (lower number) wins over lower-priority rule', async () => {
    const highPriority = makeRule({
      priority: 10,
      conditions: { model_pattern: 'gpt-*' },
      targetProvider: 'openai',
      targetModel: 'gpt-4o',
    });
    const lowPriority = makeRule({
      priority: 200,
      conditions: { model_pattern: 'gpt-*' },
      targetProvider: 'anthropic',
      targetModel: 'claude-3-5-haiku-20241022',
    });
    // Rules are already ordered by priority ASC from the repo
    mockRouterRepo.findRulesForTenant.mockResolvedValue([
      highPriority,
      lowPriority,
    ]);

    const result = await service.resolve(makeRequest('gpt-4o'), 'tenant-1');

    expect(result.provider).toBe('openai');
    expect(result.ruleId).toBe(highPriority.id);
  });

  it('global rule (tenantId: null) is used when no tenant-specific rule matches', async () => {
    const globalRule = makeRule({
      tenantId: null,
      priority: 500,
      conditions: { model_pattern: 'gpt-*' },
      targetProvider: 'openai',
      targetModel: 'gpt-4o-mini',
    });
    mockRouterRepo.findRulesForTenant.mockResolvedValue([globalRule]);

    const result = await service.resolve(makeRequest('gpt-4o'), 'tenant-1');

    expect(result.provider).toBe('openai');
    expect(result.ruleId).toBe(globalRule.id);
  });

  it('non-matching rule is skipped, falls through to model map', async () => {
    const rule = makeRule({
      conditions: { model_pattern: 'claude-*' }, // won't match gpt-4o
      targetProvider: 'anthropic',
      targetModel: 'claude-haiku-4-5-20251001',
    });
    mockRouterRepo.findRulesForTenant.mockResolvedValue([rule]);

    const result = await service.resolve(makeRequest('gpt-4o'), 'tenant-1');

    expect(result.provider).toBe('openai'); // from MODEL_PROVIDER_MAP
    expect(result.ruleId).toBeUndefined();
  });

  // ── Step 3: exact model map ───────────────────────────────────────────────

  it("exact model 'gpt-4o' → provider 'openai'", async () => {
    const result = await service.resolve(makeRequest('gpt-4o'), 'tenant-1');
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-4o');
  });

  it("exact model 'claude-haiku-4-5-20251001' → provider 'anthropic'", async () => {
    const result = await service.resolve(
      makeRequest('claude-haiku-4-5-20251001'),
      'tenant-1',
    );
    expect(result.provider).toBe('anthropic');
  });

  it("exact model 'gemini-2.0-flash-001' → provider 'gemini'", async () => {
    const result = await service.resolve(
      makeRequest('gemini-2.0-flash-001'),
      'tenant-1',
    );
    expect(result.provider).toBe('gemini');
  });

  // ── Step 4: prefix matching ───────────────────────────────────────────────

  it("prefix 'claude-3-new-model' → provider 'anthropic'", async () => {
    const result = await service.resolve(
      makeRequest('claude-3-new-model'),
      'tenant-1',
    );
    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('claude-3-new-model');
  });

  it("prefix 'gpt-5' → provider 'openai'", async () => {
    const result = await service.resolve(makeRequest('gpt-5'), 'tenant-1');
    expect(result.provider).toBe('openai');
  });

  it("prefix 'gemini-3.0-ultra' → provider 'gemini'", async () => {
    const result = await service.resolve(
      makeRequest('gemini-3.0-ultra'),
      'tenant-1',
    );
    expect(result.provider).toBe('gemini');
  });

  // ── Step 5: fallback to active provider configs ──────────────────────────

  it('falls back to first active provider config when no model matches', async () => {
    mockConfigsRepo.findActiveByTenant.mockResolvedValue([
      makeProviderConfig('anthropic'),
    ]);

    const result = await service.resolve(
      makeRequest('unknown-model-xyz'),
      'tenant-1',
    );

    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('unknown-model-xyz');
  });

  it('throws GatewayError when no provider can be resolved', async () => {
    // no rules, no model match, no configs
    mockConfigsRepo.findActiveByTenant.mockResolvedValue([]);

    await expect(
      service.resolve(makeRequest('unknown-model-xyz'), 'tenant-1'),
    ).rejects.toMatchObject({
      code: 'unknown',
      statusCode: 400,
      retryable: false,
    });
  });

  // ── matchesConditions() ───────────────────────────────────────────────────

  describe('matchesConditions()', () => {
    it('empty conditions object matches any request', () => {
      expect(service.matchesConditions(makeRequest('gpt-4o'), {})).toBe(true);
    });

    it('model_pattern glob matches correctly', () => {
      expect(
        service.matchesConditions(makeRequest('gpt-4o'), {
          model_pattern: 'gpt-4*',
        }),
      ).toBe(true);
      expect(
        service.matchesConditions(makeRequest('claude-3-5'), {
          model_pattern: 'gpt-4*',
        }),
      ).toBe(false);
    });

    it('tag condition matches xTag on request', () => {
      expect(
        service.matchesConditions(
          makeRequest('gpt-4o', { xTag: 'production' }),
          { tag: 'production' },
        ),
      ).toBe(true);
      expect(
        service.matchesConditions(makeRequest('gpt-4o', { xTag: 'staging' }), {
          tag: 'production',
        }),
      ).toBe(false);
    });

    it('max_tokens_gt: matches when maxTokens > threshold', () => {
      expect(
        service.matchesConditions(makeRequest('gpt-4o', { maxTokens: 2000 }), {
          max_tokens_gt: 1000,
        }),
      ).toBe(true);
      expect(
        service.matchesConditions(makeRequest('gpt-4o', { maxTokens: 500 }), {
          max_tokens_gt: 1000,
        }),
      ).toBe(false);
    });

    it('max_tokens_lt: matches when maxTokens < threshold', () => {
      expect(
        service.matchesConditions(makeRequest('gpt-4o', { maxTokens: 100 }), {
          max_tokens_lt: 500,
        }),
      ).toBe(true);
      expect(
        service.matchesConditions(makeRequest('gpt-4o', { maxTokens: 1000 }), {
          max_tokens_lt: 500,
        }),
      ).toBe(false);
    });

    it('all conditions must match (AND logic)', () => {
      const request = makeRequest('gpt-4o', {
        xTag: 'production',
        maxTokens: 2000,
      });
      // Both match
      expect(
        service.matchesConditions(request, {
          model_pattern: 'gpt-*',
          tag: 'production',
          max_tokens_gt: 1000,
        }),
      ).toBe(true);
      // One fails
      expect(
        service.matchesConditions(request, {
          model_pattern: 'gpt-*',
          tag: 'staging', // wrong tag
          max_tokens_gt: 1000,
        }),
      ).toBe(false);
    });

    it('null/undefined conditions always match', () => {
      expect(service.matchesConditions(makeRequest('gpt-4o'), null)).toBe(true);
      expect(service.matchesConditions(makeRequest('gpt-4o'), undefined)).toBe(
        true,
      );
    });
  });
});
