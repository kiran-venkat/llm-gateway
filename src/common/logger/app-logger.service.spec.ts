import { Logger } from '@nestjs/common';
import { AppLoggerService, LogEntry } from './app-logger.service';

describe('AppLoggerService', () => {
  let stdoutSpy: jest.SpyInstance;
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env['NODE_ENV'];
    stdoutSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    if (savedEnv === undefined) {
      delete process.env['NODE_ENV'];
    } else {
      process.env['NODE_ENV'] = savedEnv;
    }
  });

  // ── helpers ──────────────────────────────────────────────────────────────────

  function makeLogger(context = 'TestContext'): AppLoggerService {
    return new AppLoggerService(context);
  }

  function captureEntry(): LogEntry {
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const raw = (stdoutSpy.mock.calls[0][0] as string).trimEnd();
    return JSON.parse(raw) as LogEntry;
  }

  // ── production mode ──────────────────────────────────────────────────────────

  describe('production mode', () => {
    beforeEach(() => {
      process.env['NODE_ENV'] = 'production';
    });

    it('log() outputs a JSON line with level=info', () => {
      const logger = makeLogger();
      logger.log('hello world');

      const entry = captureEntry();
      expect(entry.level).toBe('info');
      expect(entry.message).toBe('hello world');
    });

    it('contains all required LogEntry fields', () => {
      const logger = makeLogger('AuthGuard');
      logger.log('cache hit');

      const entry = captureEntry();
      expect(typeof entry.level).toBe('string');
      expect(typeof entry.timestamp).toBe('string');
      expect(typeof entry.context).toBe('string');
      expect(typeof entry.message).toBe('string');
      // timestamp must be valid ISO 8601
      expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
    });

    it('context field matches the constructor argument', () => {
      const logger = makeLogger('RateLimitGuard');
      logger.log('exceeded');

      const entry = captureEntry();
      expect(entry.context).toBe('RateLimitGuard');
    });

    it('includes requestId and tenantId from meta', () => {
      const logger = makeLogger();
      logger.log('Auth cache hit', { requestId: 'req-abc', tenantId: 'tid-xyz' });

      const entry = captureEntry();
      expect(entry.requestId).toBe('req-abc');
      expect(entry.tenantId).toBe('tid-xyz');
    });

    it('includes arbitrary extra fields from meta', () => {
      const logger = makeLogger('GatewayService');
      logger.log('Request completed', {
        requestId: 'r1',
        tenantId: 't1',
        provider: 'openai',
        latencyMs: 312,
        costUsd: 0.00008,
        promptTokens: 200,
        completionTokens: 50,
      });

      const entry = captureEntry();
      expect(entry.provider).toBe('openai');
      expect(entry.latencyMs).toBe(312);
      expect(entry.costUsd).toBe(0.00008);
      expect(entry.promptTokens).toBe(200);
      expect(entry.completionTokens).toBe(50);
    });

    it('warn() outputs level=warn', () => {
      const logger = makeLogger();
      logger.warn('Rate limit exceeded', { tenantId: 'abc', limitType: 'rpm' });

      const entry = captureEntry();
      expect(entry.level).toBe('warn');
      expect(entry.tenantId).toBe('abc');
    });

    it('error() with an Error object extracts stack', () => {
      const logger = makeLogger();
      const err = new Error('boom');
      logger.error('something failed', err);

      const entry = captureEntry();
      expect(entry.level).toBe('error');
      expect(entry.message).toBe('something failed');
      expect(typeof entry.stack).toBe('string');
      expect(entry.errorMessage).toBe('boom');
    });

    it('error() with a meta object spreads fields', () => {
      const logger = makeLogger();
      logger.error('Budget exceeded', { tenantId: 't1', pct: 105.3 });

      const entry = captureEntry();
      expect(entry.level).toBe('error');
      expect(entry.tenantId).toBe('t1');
      expect(entry.pct).toBe(105.3);
    });

    it('debug() outputs level=debug', () => {
      const logger = makeLogger();
      logger.debug('cache miss', { requestId: 'r2' });

      const entry = captureEntry();
      expect(entry.level).toBe('debug');
      expect(entry.requestId).toBe('r2');
    });

    it('each JSON line ends with a newline', () => {
      const logger = makeLogger();
      logger.log('test');

      const raw = stdoutSpy.mock.calls[0][0] as string;
      expect(raw.endsWith('\n')).toBe(true);
    });

    it('output is valid JSON (parseable)', () => {
      const logger = makeLogger();
      logger.warn('test warn');

      const raw = (stdoutSpy.mock.calls[0][0] as string).trim();
      expect(() => JSON.parse(raw)).not.toThrow();
    });

    it('log() without meta still includes all base fields', () => {
      const logger = makeLogger('CacheInterceptor');
      logger.log('Cache hit');

      const entry = captureEntry();
      expect(entry.level).toBe('info');
      expect(entry.context).toBe('CacheInterceptor');
      expect(entry.message).toBe('Cache hit');
      // no meta fields — no extra keys beyond the base set
      expect(entry.requestId).toBeUndefined();
    });
  });

  // ── development mode ─────────────────────────────────────────────────────────

  describe('development mode', () => {
    let nestLogSpy: jest.SpyInstance;
    let nestWarnSpy: jest.SpyInstance;
    let nestErrorSpy: jest.SpyInstance;
    let nestDebugSpy: jest.SpyInstance;

    beforeEach(() => {
      process.env['NODE_ENV'] = 'development';
      // Mock NestJS Logger methods so they don't write to stdout themselves.
      // This lets us assert that (a) NestJS Logger is called, and
      // (b) our JSON writer is NOT called.
      nestLogSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
      nestWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      nestErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      nestDebugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});
    });

    afterEach(() => {
      nestLogSpy.mockRestore();
      nestWarnSpy.mockRestore();
      nestErrorSpy.mockRestore();
      nestDebugSpy.mockRestore();
    });

    it('log() delegates to NestJS Logger — no JSON to stdout', () => {
      const logger = makeLogger();
      logger.log('dev log message');

      expect(nestLogSpy).toHaveBeenCalledTimes(1);
      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('warn() delegates to NestJS Logger — no JSON to stdout', () => {
      const logger = makeLogger();
      logger.warn('dev warn');

      expect(nestWarnSpy).toHaveBeenCalledTimes(1);
      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('error() with Error delegates to NestJS Logger', () => {
      const logger = makeLogger();
      logger.error('dev error', new Error('oops'));

      expect(nestErrorSpy).toHaveBeenCalledTimes(1);
      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('debug() delegates to NestJS Logger', () => {
      const logger = makeLogger();
      logger.debug('dev debug');

      expect(nestDebugSpy).toHaveBeenCalledTimes(1);
      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('meta fields are appended as JSON string in dev format', () => {
      const logger = makeLogger();
      logger.log('Auth cache hit', { requestId: 'r1', tenantId: 't1' });

      expect(nestLogSpy).toHaveBeenCalledTimes(1);
      const arg = nestLogSpy.mock.calls[0][0] as string;
      expect(arg).toContain('Auth cache hit');
      expect(arg).toContain('"requestId"');
      expect(arg).toContain('"tenantId"');
    });
  });
});
