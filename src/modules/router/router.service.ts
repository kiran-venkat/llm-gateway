import { Injectable } from '@nestjs/common';
import { RoutingRule } from '@prisma/client';
import { minimatch } from 'minimatch';
import { GatewayRequest } from '../../common/dto/gateway-request.dto';
import { GatewayError } from '../../common/dto/gateway-error.dto';
import { RoutingDecision } from '../../common/interfaces/routing-decision.interface';
import { ProviderConfigsRepository } from '../providers/provider-configs.repository';
import { RouterRepository } from './router.repository';
import { MODEL_PREFIX_MAP, MODEL_PROVIDER_MAP } from './model-map.constant';

/** Shape of the JSONB conditions column on routing_rules */
interface RuleConditions {
  model_pattern?: string;
  tag?: string;
  max_tokens_gt?: number;
  max_tokens_lt?: number;
}

/**
 * Extended GatewayRequest fields used only by the router.
 * These are set by the controller before calling resolve() and are not
 * forwarded to provider adapters.
 */
export interface RouterRequest extends GatewayRequest {
  /** Optional explicit provider override from x-provider header */
  xProvider?: string;
  /** Optional tag for rule matching, from x-tag header */
  xTag?: string;
}

@Injectable()
export class RouterService {
  constructor(
    private readonly routerRepo: RouterRepository,
    private readonly providerConfigsRepo: ProviderConfigsRepository,
  ) {}

  /**
   * Resolve which provider and model to use for this request.
   *
   * Resolution order (first match wins):
   *   1. Explicit x-provider header override
   *   2. Tenant + global routing rules (priority ASC)
   *   3. Exact model name lookup (MODEL_PROVIDER_MAP)
   *   4. Model prefix matching (MODEL_PREFIX_MAP)
   *   5. Fallback to first active provider config for the tenant
   */
  async resolve(
    request: RouterRequest,
    tenantId: string,
  ): Promise<RoutingDecision> {
    // Step 1 — explicit provider override
    if (request.xProvider) {
      return { provider: request.xProvider, model: request.model };
    }

    // Step 2 — routing rules (tenant-specific + global)
    const rules = await this.routerRepo.findRulesForTenant(tenantId);
    for (const rule of rules) {
      if (this.matchesConditions(request, rule.conditions)) {
        return {
          provider: rule.targetProvider,
          model: rule.targetModel,
          ruleId: rule.id,
        };
      }
    }

    // Step 3 — exact model name lookup
    const exactProvider = MODEL_PROVIDER_MAP[request.model];
    if (exactProvider) {
      return { provider: exactProvider, model: request.model };
    }

    // Step 4 — prefix matching
    for (const entry of MODEL_PREFIX_MAP) {
      if (request.model.startsWith(entry.prefix)) {
        return { provider: entry.provider, model: request.model };
      }
    }

    // Step 5 — fallback to first active provider config for this tenant
    const activeConfigs =
      await this.providerConfigsRepo.findActiveByTenant(tenantId);
    if (activeConfigs.length > 0) {
      return { provider: activeConfigs[0].provider, model: request.model };
    }

    // No path found
    const err: GatewayError = {
      code: 'unknown',
      message: `No provider could be resolved for model '${request.model}'. Configure a provider via POST /api/v1/providers.`,
      provider: '',
      retryable: false,
      statusCode: 400,
    };
    throw err;
  }

  /**
   * Evaluate a rule's JSONB conditions against the current request.
   * All present conditions must match (AND logic).
   * An empty/null conditions object matches everything.
   */
  matchesConditions(request: RouterRequest, conditions: unknown): boolean {
    // null/empty conditions = universal match (catch-all rule). Do not change
    // this to return false — a rule with no conditions is intentionally meant
    // to match every request (e.g. "route all traffic to provider X").
    if (!conditions || typeof conditions !== 'object') return true;
    const c = conditions as RuleConditions;

    if (
      c.model_pattern !== undefined &&
      !minimatch(request.model, c.model_pattern)
    ) {
      return false;
    }

    if (c.tag !== undefined && request.xTag !== c.tag) {
      return false;
    }

    // If request.maxTokens is undefined, all token-based conditions fail
    // silently (the rule is skipped). A request without a token constraint
    // cannot satisfy a token-based rule — this is intentional.
    if (
      c.max_tokens_gt !== undefined &&
      (request.maxTokens === undefined || request.maxTokens <= c.max_tokens_gt)
    ) {
      return false;
    }

    if (
      c.max_tokens_lt !== undefined &&
      (request.maxTokens === undefined || request.maxTokens >= c.max_tokens_lt)
    ) {
      return false;
    }

    return true;
  }

  /** Used in tests and the gateway controller to evaluate a single rule */
  matchesRule(request: RouterRequest, rule: RoutingRule): boolean {
    return this.matchesConditions(request, rule.conditions);
  }
}
