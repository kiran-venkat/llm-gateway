import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { MissingTenantIdError } from '../repositories/base.repository';

export interface ErrorResponse {
  error: string;
  message: string;
  request_id: string;
  timestamp: string;
  path: string;
}

/**
 * Converts any exception into a machine-readable ErrorResponse.
 *
 * Registered globally in main.ts so every unhandled error in the application
 * produces the same JSON shape — callers can always rely on the contract.
 *
 * Stack traces are included in development and suppressed in production
 * to avoid leaking internals; the raw error is always logged server-side.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(private readonly nodeEnv: string = 'production') {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    // Prefer the ID stamped by RequestIdMiddleware; fall back for tests/calls
    // that bypass the middleware stack (e.g. raw unit-test invocations).
    const requestId = req.requestId ?? randomUUID();

    const { status, body } = this.buildResponse(exception, req, requestId);

    if (status >= 500) {
      this.logger.error(
        `[${requestId}] ${req.method} ${req.path} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(
        `[${requestId}] ${req.method} ${req.path} → ${status}: ${body.message}`,
      );
    }

    res.status(status).json(body);
  }

  private buildResponse(
    exception: unknown,
    req: Request,
    requestId: string,
  ): { status: number; body: ErrorResponse } {
    const timestamp = new Date().toISOString();
    const path = req.path;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();

      if (typeof raw === 'object' && raw !== null) {
        // Structured HttpException body: spread domain fields so guards like
        // RateLimitGuard can include extra context (retry_after_ms, limit_type)
        // without the filter discarding them.
        const structured = raw as Record<string, unknown>;
        const message =
          structured['message']?.toString() ?? exception.message;
        return {
          status,
          body: {
            ...structured,
            error: structured['error']?.toString() ?? this.statusToCode(status),
            message,
            request_id: requestId,
            timestamp,
            path,
          } as ErrorResponse,
        };
      }

      return {
        status,
        body: {
          error: this.statusToCode(status),
          message: raw as string,
          request_id: requestId,
          timestamp,
          path,
        },
      };
    }

    if (exception instanceof MissingTenantIdError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        body: {
          error: 'bad_request',
          message: exception.message,
          request_id: requestId,
          timestamp,
          path,
        },
      };
    }

    // Unknown error — hide internals in production, expose in development
    const isDev = this.nodeEnv === 'development';
    const message = isDev
      ? exception instanceof Error
        ? exception.message
        : String(exception)
      : 'An unexpected error occurred';

    const body: ErrorResponse & { stack?: string } = {
      error: 'internal_server_error',
      message,
      request_id: requestId,
      timestamp,
      path,
    };

    if (isDev && exception instanceof Error && exception.stack) {
      body['stack'] = exception.stack;
    }

    return { status: HttpStatus.INTERNAL_SERVER_ERROR, body };
  }

  private statusToCode(status: number): string {
    const map: Record<number, string> = {
      400: 'bad_request',
      401: 'unauthorized',
      403: 'forbidden',
      404: 'not_found',
      405: 'method_not_allowed',
      409: 'conflict',
      422: 'unprocessable_entity',
      429: 'too_many_requests',
      500: 'internal_server_error',
      502: 'bad_gateway',
      503: 'service_unavailable',
    };
    return map[status] ?? `http_${status}`;
  }
}
