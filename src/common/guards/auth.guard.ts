import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { Redis } from 'ioredis';
import { Request } from 'express';
import { hashApiKey } from '../utils/hash.util';
import { AuthContext } from '../interfaces/auth-context.interface';
import {
  AUTH_CACHE_PREFIX,
  AUTH_CACHE_TTL_SECONDS,
} from '../constants/redis-keys';
import { ApiKeysRepository } from '../../modules/api-keys/api-keys.repository';
import { TenantsService } from '../../modules/tenants/tenants.service';
import { AppLoggerService } from '../logger/app-logger.service';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new AppLoggerService(AuthGuard.name);

  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly apiKeysRepo: ApiKeysRepository,
    private readonly tenantsService: TenantsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    // ── a. Extract token ──────────────────────────────────────────────────────
    const token = this.extractBearer(req);
    if (!token) {
      throw new UnauthorizedException(
        'Authorization header must be "Bearer <token>"',
      );
    }

    // ── b. Hash ───────────────────────────────────────────────────────────────
    const keyHash = hashApiKey(token);
    const cacheKey = `${AUTH_CACHE_PREFIX}${keyHash}`;

    // ── c. Redis fast path ────────────────────────────────────────────────────
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      req.tenant = JSON.parse(cached) as AuthContext;
      const cachedCtx = req.tenant as AuthContext;
      this.logger.log('Auth cache hit', {
        requestId: req.requestId,
        tenantId: cachedCtx.tenantId,
      });
      return true;
    }

    // ── d. DB lookup ──────────────────────────────────────────────────────────
    const apiKey = await this.apiKeysRepo.findByKeyHash(keyHash);
    if (!apiKey) {
      this.logger.warn('Auth failed', {
        requestId: req.requestId,
        reason: 'invalid_key',
      });
      throw new UnauthorizedException('Invalid API key');
    }
    if (!apiKey.isActive) {
      this.logger.warn('Auth failed', {
        requestId: req.requestId,
        reason: 'key_revoked',
      });
      throw new UnauthorizedException('API key has been revoked');
    }
    if (apiKey.expiresAt !== null && apiKey.expiresAt < new Date()) {
      this.logger.warn('Auth failed', {
        requestId: req.requestId,
        reason: 'key_expired',
      });
      throw new UnauthorizedException('API key has expired');
    }

    // ── e. Load tenant ────────────────────────────────────────────────────────
    let tenantPlan: string;
    let tenantIsActive: boolean;
    try {
      const tenant = await this.tenantsService.findById(apiKey.tenantId);
      tenantPlan = tenant.plan;
      tenantIsActive = tenant.isActive;
    } catch {
      throw new UnauthorizedException('Associated tenant not found');
    }
    if (!tenantIsActive) {
      throw new UnauthorizedException('Tenant account is suspended');
    }

    // ── f. Build AuthContext ──────────────────────────────────────────────────
    const authContext: AuthContext = {
      tenantId: apiKey.tenantId,
      apiKeyId: apiKey.id,
      plan: tenantPlan,
    };

    this.logger.log('Auth DB lookup', {
      requestId: req.requestId,
      tenantId: apiKey.tenantId,
      apiKeyId: apiKey.id,
    });

    // ── g. Populate Redis cache ───────────────────────────────────────────────
    await this.redis.set(
      cacheKey,
      JSON.stringify(authContext),
      'EX',
      AUTH_CACHE_TTL_SECONDS,
    );

    // ── h. Attach to request ──────────────────────────────────────────────────
    req.tenant = authContext;

    // ── i. Fire-and-forget: update last_used_at ───────────────────────────────
    // Never awaited — the client must not pay for our bookkeeping.
    void this.apiKeysRepo
      .update(apiKey.tenantId, apiKey.id, { lastUsedAt: new Date() })
      .catch((err: unknown) =>
        this.logger.error('Failed to update last_used_at', err),
      );

    return true;
  }

  private extractBearer(req: Request): string | null {
    const header = req.headers['authorization'];
    if (!header || !header.startsWith('Bearer ')) return null;
    const token = header.slice(7).trim();
    return token.length > 0 ? token : null;
  }
}
