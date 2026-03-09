import { HttpException, HttpStatus, ArgumentsHost } from '@nestjs/common';
import {
  GlobalExceptionFilter,
  ErrorResponse,
} from './global-exception.filter';
import { MissingTenantIdError } from '../repositories/base.repository';

// ---------------------------------------------------------------------------
// Helpers — build a minimal ArgumentsHost mock
// ---------------------------------------------------------------------------

function makeHost(overrides: {
  path?: string;
  method?: string;
  headers?: Record<string, string>;
  requestId?: string;
}): { host: ArgumentsHost; jsonMock: jest.Mock; statusMock: jest.Mock } {
  const jsonMock = jest.fn();
  const statusMock = jest.fn().mockReturnValue({ json: jsonMock });

  const req = {
    path: overrides.path ?? '/test',
    method: overrides.method ?? 'GET',
    headers: overrides.headers ?? {},
    requestId: overrides.requestId,
  };

  const host = {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({ status: statusMock }),
    }),
  } as unknown as ArgumentsHost;

  return { host, jsonMock, statusMock };
}

function captureResponse(
  filter: GlobalExceptionFilter,
  exception: unknown,
  hostOverrides: {
    path?: string;
    headers?: Record<string, string>;
    requestId?: string;
  } = {},
): { status: number; body: ErrorResponse & { stack?: string } } {
  const { host, jsonMock, statusMock } = makeHost(hostOverrides);
  filter.catch(exception, host);
  const status: number = (statusMock.mock.calls[0] as [number])[0];
  const body = (
    jsonMock.mock.calls[0] as [ErrorResponse & { stack?: string }]
  )[0];
  return { status, body };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GlobalExceptionFilter', () => {
  // Use production mode by default; override per suite where needed.
  let filter: GlobalExceptionFilter;

  beforeEach(() => {
    filter = new GlobalExceptionFilter('production');
    jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
    jest.spyOn(filter['logger'], 'warn').mockImplementation(() => undefined);
  });

  // -------------------------------------------------------------------------
  // Response shape — every response must have all required fields
  // -------------------------------------------------------------------------

  describe('response shape', () => {
    it('always includes all required fields', () => {
      const { body } = captureResponse(
        filter,
        new HttpException('Not Found', 404),
      );
      expect(body).toMatchObject<Partial<ErrorResponse>>({
        error: expect.any(String) as string,
        message: expect.any(String) as string,
        request_id: expect.any(String) as string,
        timestamp: expect.any(String) as string,
        path: expect.any(String) as string,
      });
    });

    it('timestamp is a valid ISO 8601 string', () => {
      const { body } = captureResponse(filter, new HttpException('ok', 200));
      expect(() => new Date(body.timestamp)).not.toThrow();
      expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
    });

    it('path reflects the request path', () => {
      const { body } = captureResponse(filter, new HttpException('x', 400), {
        path: '/v1/chat/completions',
      });
      expect(body.path).toBe('/v1/chat/completions');
    });
  });

  // -------------------------------------------------------------------------
  // HttpException
  // -------------------------------------------------------------------------

  describe('HttpException', () => {
    it('uses the HTTP status code from the exception', () => {
      const { status } = captureResponse(
        filter,
        new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED),
      );
      expect(status).toBe(401);
    });

    it('maps status to a snake_case error code', () => {
      const { body } = captureResponse(
        filter,
        new HttpException('x', HttpStatus.UNAUTHORIZED),
      );
      expect(body.error).toBe('unauthorized');
    });

    it('extracts the message string from a plain HttpException', () => {
      const { body } = captureResponse(
        filter,
        new HttpException('Not Found', HttpStatus.NOT_FOUND),
      );
      expect(body.message).toBe('Not Found');
      expect(body.error).toBe('not_found');
    });

    it('extracts the message from an object-response HttpException (validation errors)', () => {
      const { body } = captureResponse(
        filter,
        new HttpException(
          { message: 'Validation failed', error: 'Bad Request' },
          HttpStatus.BAD_REQUEST,
        ),
      );
      expect(body.message).toBe('Validation failed');
    });

    it.each([
      [400, 'bad_request'],
      [401, 'unauthorized'],
      [403, 'forbidden'],
      [404, 'not_found'],
      [409, 'conflict'],
      [429, 'too_many_requests'],
      [500, 'internal_server_error'],
      [503, 'service_unavailable'],
    ])('maps HTTP %i → error code "%s"', (httpStatus, expectedCode) => {
      const { body } = captureResponse(
        filter,
        new HttpException('x', httpStatus),
      );
      expect(body.error).toBe(expectedCode);
    });
  });

  // -------------------------------------------------------------------------
  // MissingTenantIdError
  // -------------------------------------------------------------------------

  describe('MissingTenantIdError', () => {
    it('returns 400 Bad Request', () => {
      const { status } = captureResponse(
        filter,
        new MissingTenantIdError('findById'),
      );
      expect(status).toBe(400);
    });

    it('returns error code "bad_request"', () => {
      const { body } = captureResponse(
        filter,
        new MissingTenantIdError('findById'),
      );
      expect(body.error).toBe('bad_request');
    });

    it('includes the domain error message', () => {
      const { body } = captureResponse(
        filter,
        new MissingTenantIdError('findMany'),
      );
      expect(body.message).toContain('findMany');
    });
  });

  // -------------------------------------------------------------------------
  // Unknown errors — production vs development
  // -------------------------------------------------------------------------

  describe('unknown errors in production', () => {
    it('returns 500', () => {
      const { status } = captureResponse(filter, new Error('db blew up'));
      expect(status).toBe(500);
    });

    it('hides the real error message', () => {
      const { body } = captureResponse(filter, new Error('secret db password'));
      expect(body.message).not.toContain('secret db password');
      expect(body.message).toBe('An unexpected error occurred');
    });

    it('does not include a stack trace', () => {
      const { body } = captureResponse(filter, new Error('boom'));
      expect(body.stack).toBeUndefined();
    });

    it('handles non-Error thrown values gracefully', () => {
      const { status, body } = captureResponse(
        filter,
        'string thrown as error',
      );
      expect(status).toBe(500);
      expect(body.message).toBe('An unexpected error occurred');
    });
  });

  describe('unknown errors in development', () => {
    let devFilter: GlobalExceptionFilter;

    beforeEach(() => {
      devFilter = new GlobalExceptionFilter('development');
      jest
        .spyOn(devFilter['logger'], 'error')
        .mockImplementation(() => undefined);
    });

    it('includes the real error message', () => {
      const { body } = captureResponse(
        devFilter,
        new Error('db connection refused'),
      );
      expect(body.message).toBe('db connection refused');
    });

    it('includes the stack trace', () => {
      const err = new Error('boom');
      const { body } = captureResponse(devFilter, err);
      expect(body.stack).toBeDefined();
      expect(body.stack).toContain('Error: boom');
    });

    it('handles non-Error values without crashing', () => {
      const { status, body } = captureResponse(devFilter, 'raw string thrown');
      expect(status).toBe(500);
      expect(body.message).toBe('raw string thrown');
      expect(body.stack).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // X-Request-Id header
  // -------------------------------------------------------------------------

  describe('X-Request-Id', () => {
    it('uses the requestId stamped by RequestIdMiddleware', () => {
      const { body } = captureResponse(filter, new HttpException('x', 400), {
        requestId: 'client-trace-abc-123',
      });
      expect(body.request_id).toBe('client-trace-abc-123');
    });

    it('generates a UUID when X-Request-Id header is absent', () => {
      const { body } = captureResponse(filter, new HttpException('x', 400));
      // UUID v4 format
      expect(body.request_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it('generates a different UUID for each request without a header', () => {
      const { body: body1 } = captureResponse(
        filter,
        new HttpException('x', 400),
      );
      const { body: body2 } = captureResponse(
        filter,
        new HttpException('x', 400),
      );
      expect(body1.request_id).not.toBe(body2.request_id);
    });
  });

  // -------------------------------------------------------------------------
  // Logging
  // -------------------------------------------------------------------------

  describe('logging', () => {
    it('logs 5xx errors at error level', () => {
      const spy = jest
        .spyOn(filter['logger'], 'error')
        .mockImplementation(() => undefined);
      captureResponse(filter, new Error('boom'));
      expect(spy).toHaveBeenCalled();
    });

    it('logs 4xx errors at warn level', () => {
      const spy = jest
        .spyOn(filter['logger'], 'warn')
        .mockImplementation(() => undefined);
      captureResponse(filter, new HttpException('bad', 400));
      expect(spy).toHaveBeenCalled();
    });
  });
});
