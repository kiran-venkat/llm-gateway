import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AppConfigService } from '../../config/config.service';

/**
 * AdminGuard — protects management endpoints with ADMIN_SECRET.
 *
 * Checks: Authorization: Bearer <ADMIN_SECRET>
 *   - Missing / malformed header → 401 UnauthorizedException
 *   - Present but wrong secret   → 403 ForbiddenException
 *   - Correct secret             → passes (returns true)
 *
 * Intentionally separate from AuthGuard. AuthGuard validates tenant API keys
 * and sets req.tenant for LLM endpoints. AdminGuard validates the operator
 * secret for management endpoints. They must never be mixed on the same
 * endpoint — admin endpoints do NOT set req.tenant.
 *
 * AppConfigService is @Global() so no module import is needed at usage sites.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const token = this.extractBearer(req);

    if (!token) {
      throw new UnauthorizedException('Admin authorization required');
    }

    if (token !== this.config.getAdminSecret()) {
      throw new ForbiddenException('Invalid admin secret');
    }

    return true;
  }

  private extractBearer(req: Request): string | null {
    const header = req.headers['authorization'];
    if (!header?.startsWith('Bearer ')) return null;
    const token = header.slice(7).trim();
    return token.length > 0 ? token : null;
  }
}
