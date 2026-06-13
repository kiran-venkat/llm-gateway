import { Logger } from '@nestjs/common';

/**
 * Fields that callers can attach to any log entry.
 * All are optional — include what you have at the call site.
 * The index signature allows arbitrary extra fields (e.g. costUsd, tokens).
 */
export interface LogMeta {
  requestId?: string;
  tenantId?: string;
  provider?: string;
  latencyMs?: number;
  [key: string]: unknown;
}

/**
 * The shape of every JSON line written in production.
 * Extends LogMeta so all caller-supplied fields are present at the top level.
 */
export interface LogEntry extends LogMeta {
  level: 'debug' | 'info' | 'warn' | 'error';
  timestamp: string; // ISO 8601
  context: string; // module name e.g. "AuthGuard"
  message: string;
}

/**
 * Structured application logger.
 *
 * Development (NODE_ENV !== 'production'):
 *   Delegates to NestJS Logger for readable, coloured terminal output.
 *
 * Production:
 *   Writes one JSON-serialised LogEntry per line to stdout so log shippers
 *   (Datadog, CloudWatch, Loki) can index every field individually.
 *
 * Usage — drop-in for `new Logger(X.name)`:
 *   private readonly logger = new AppLoggerService(MyService.name);
 *   this.logger.log('Request completed', { requestId, tenantId, latencyMs });
 */
export class AppLoggerService {
  private readonly nestLogger: Logger;
  private readonly isProd: boolean;

  constructor(private readonly context: string) {
    this.nestLogger = new Logger(context);
    this.isProd = process.env['NODE_ENV'] === 'production';
  }

  log(message: string, meta?: LogMeta): void {
    if (this.isProd) {
      this.write('info', message, meta);
    } else {
      this.nestLogger.log(this.devFormat(message, meta));
    }
  }

  warn(message: string, meta?: LogMeta): void {
    if (this.isProd) {
      this.write('warn', message, meta);
    } else {
      this.nestLogger.warn(this.devFormat(message, meta));
    }
  }

  /**
   * Accepts either:
   *   error(message, meta)  — structured error with key/value fields
   *   error(message, err)   — exception logging; stack is extracted automatically
   *
   * Both paths preserve backward-compatibility with existing callers that pass
   * an Error or a stack string as the second argument.
   */
  error(message: string, metaOrError?: LogMeta | unknown): void {
    if (this.isProd) {
      this.write('error', message, this.coerceToMeta(metaOrError));
    } else {
      if (metaOrError instanceof Error) {
        this.nestLogger.error(message, metaOrError.stack);
      } else if (
        metaOrError !== null &&
        metaOrError !== undefined &&
        typeof metaOrError === 'object' &&
        !Array.isArray(metaOrError)
      ) {
        this.nestLogger.error(this.devFormat(message, metaOrError as LogMeta));
      } else {
        this.nestLogger.error(
          message,
          typeof metaOrError === 'string'
            ? metaOrError
            : String(metaOrError ?? ''),
        );
      }
    }
  }

  debug(message: string, meta?: LogMeta): void {
    if (this.isProd) {
      this.write('debug', message, meta);
    } else {
      this.nestLogger.debug(this.devFormat(message, meta));
    }
  }

  // ── private helpers ─────────────────────────────────────────────────────────

  private write(
    level: LogEntry['level'],
    message: string,
    meta?: LogMeta,
  ): void {
    const entry: LogEntry = {
      level,
      timestamp: new Date().toISOString(),
      context: this.context,
      message,
      ...meta,
    };
    process.stdout.write(JSON.stringify(entry) + '\n');
  }

  private devFormat(message: string, meta?: LogMeta): string {
    if (!meta || Object.keys(meta).length === 0) return message;
    return `${message} ${JSON.stringify(meta)}`;
  }

  private coerceToMeta(input: unknown): LogMeta {
    if (!input) return {};
    if (input instanceof Error) {
      return { stack: input.stack, errorMessage: input.message };
    }
    if (typeof input === 'object' && !Array.isArray(input)) {
      return input as LogMeta;
    }
    return {};
  }
}
