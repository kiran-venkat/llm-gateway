import { RequestIdMiddleware } from './request-id.middleware';
import { Request, Response } from 'express';

function makeReq(xRequestId?: string): Partial<Request> {
  return {
    headers: xRequestId ? { 'x-request-id': xRequestId } : {},
    requestId: undefined as unknown as string,
  };
}

function makeRes(): jest.Mocked<Pick<Response, 'setHeader'>> {
  return { setHeader: jest.fn() };
}

describe('RequestIdMiddleware', () => {
  let middleware: RequestIdMiddleware;
  const next = jest.fn();

  beforeEach(() => {
    middleware = new RequestIdMiddleware();
    next.mockClear();
  });

  it('generates a UUID and attaches it to req.requestId', () => {
    const req = makeReq();
    middleware.use(req as Request, makeRes() as unknown as Response, next);

    expect(req.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('sets X-Request-Id response header', () => {
    const req = makeReq();
    const res = makeRes();
    middleware.use(req as Request, res as unknown as Response, next);

    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', req.requestId);
  });

  it('honours an inbound X-Request-Id header from the caller', () => {
    const inboundId = 'client-trace-abc-123';
    const req = makeReq(inboundId);
    const res = makeRes();
    middleware.use(req as Request, res as unknown as Response, next);

    expect(req.requestId).toBe(inboundId);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', inboundId);
  });

  it('ignores an empty inbound X-Request-Id and generates a fresh UUID', () => {
    const req = makeReq('');
    middleware.use(req as Request, makeRes() as unknown as Response, next);

    expect(req.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('calls next()', () => {
    middleware.use(
      makeReq() as Request,
      makeRes() as unknown as Response,
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('generates a unique ID per request', () => {
    const req1 = makeReq();
    const req2 = makeReq();
    middleware.use(req1 as Request, makeRes() as unknown as Response, next);
    middleware.use(req2 as Request, makeRes() as unknown as Response, next);

    expect(req1.requestId).not.toBe(req2.requestId);
  });
});
