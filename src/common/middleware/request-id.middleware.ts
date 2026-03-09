import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

/**
 * Generates a UUID for every inbound request and makes it available everywhere:
 *
 *   - req.requestId     — readable by controllers, services, guards, filters
 *   - X-Request-Id      — set on the response immediately so every reply
 *                         (success, 401, 404, 500, SSE stream) carries the header
 *
 * If the caller sends their own X-Request-Id header we honour it, which lets
 * clients correlate their own traces with our logs end-to-end.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const inbound = req.headers['x-request-id'];
    const requestId =
      typeof inbound === 'string' && inbound.length > 0 ? inbound : randomUUID();

    req.requestId = requestId;
    // Set on response immediately — survives AuthGuard throws, SSE flush, etc.
    res.setHeader('X-Request-Id', requestId);

    next();
  }
}
