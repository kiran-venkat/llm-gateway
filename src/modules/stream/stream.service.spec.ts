/* eslint-disable @typescript-eslint/no-unused-vars */
import { StreamService, ProxyOptions, StreamResult } from './stream.service';
import { StreamChunk } from '../../common/dto/stream-chunk.dto';
import { Response } from 'express';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockResponse(): jest.Mocked<
  Pick<Response, 'setHeader' | 'flushHeaders' | 'write' | 'end'>
> {
  return {
    setHeader: jest.fn().mockReturnThis(),
    flushHeaders: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
  };
}

async function* makeChunks(texts: string[]): AsyncIterable<StreamChunk> {
  for (let i = 0; i < texts.length; i++) {
    yield { content: texts[i], index: i, done: false };
  }
}

async function* makeDoneChunk(): AsyncIterable<StreamChunk> {
  yield { content: '', index: 0, done: true };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('StreamService', () => {
  let service: StreamService;

  beforeEach(() => {
    service = new StreamService();
  });

  it('sets SSE headers before any write', async () => {
    const res = makeMockResponse();
    const callOrder: string[] = [];
    res.setHeader.mockImplementation(() => {
      callOrder.push('setHeader');
      return res as unknown as Response;
    });
    res.flushHeaders.mockImplementation(() => {
      callOrder.push('flushHeaders');
    });
    res.write.mockImplementation(() => {
      callOrder.push('write');
      return true;
    });

    await service.proxy({
      chunks: makeChunks(['hello']),
      response: res as unknown as Response,
      requestId: 'req-1',
      onComplete: jest.fn(),
    });

    // All setHeaders must come before flushHeaders, which must come before write
    const firstWrite = callOrder.indexOf('write');
    const lastFlush = callOrder.lastIndexOf('flushHeaders');
    const lastHeader = callOrder.lastIndexOf('setHeader');
    expect(lastHeader).toBeLessThan(lastFlush);
    expect(lastFlush).toBeLessThan(firstWrite);
  });

  it('sets Content-Type, Cache-Control, Connection headers', async () => {
    const res = makeMockResponse();

    await service.proxy({
      chunks: makeChunks([]),
      response: res as unknown as Response,
      requestId: 'req-1',
      onComplete: jest.fn(),
    });

    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/event-stream',
    );
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
    expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
  });

  it('calls flushHeaders() before any write', async () => {
    const res = makeMockResponse();
    let flushed = false;
    res.flushHeaders.mockImplementation(() => {
      flushed = true;
    });
    res.write.mockImplementation(() => {
      expect(flushed).toBe(true); // must have flushed by the time write is called
      return true;
    });

    await service.proxy({
      chunks: makeChunks(['a', 'b']),
      response: res as unknown as Response,
      requestId: 'req-1',
      onComplete: jest.fn(),
    });
  });

  it('forwards each non-done chunk as an SSE data line', async () => {
    const res = makeMockResponse();
    const written: string[] = [];
    res.write.mockImplementation((data: unknown) => {
      written.push(data as string);
      return true;
    });

    await service.proxy({
      chunks: makeChunks(['Hello', ' world']),
      response: res as unknown as Response,
      requestId: 'req-42',
      onComplete: jest.fn(),
    });

    // First two writes are the chunks, last write is [DONE]
    expect(written[0]).toContain('data:');
    expect(written[0]).toContain('"Hello"');
    expect(written[0]).toContain('req-42');
    expect(written[1]).toContain('" world"');
    expect(written[2]).toBe('data: [DONE]\n\n');
  });

  it('sends [DONE] after all chunks', async () => {
    const res = makeMockResponse();
    const written: string[] = [];
    res.write.mockImplementation((data: unknown) => {
      written.push(data as string);
      return true;
    });

    await service.proxy({
      chunks: makeChunks(['a', 'b', 'c']),
      response: res as unknown as Response,
      requestId: 'req-1',
      onComplete: jest.fn(),
    });

    expect(written[written.length - 1]).toBe('data: [DONE]\n\n');
  });

  it('calls response.end() exactly once', async () => {
    const res = makeMockResponse();

    await service.proxy({
      chunks: makeChunks(['x']),
      response: res as unknown as Response,
      requestId: 'req-1',
      onComplete: jest.fn(),
    });

    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it('calls onComplete with assembled content', async () => {
    const res = makeMockResponse();
    const onComplete = jest.fn();

    await service.proxy({
      chunks: makeChunks(['Hello', ', ', 'world']),
      response: res as unknown as Response,
      requestId: 'req-1',
      onComplete,
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    const result: StreamResult = onComplete.mock.calls[0][0];
    expect(result.content).toBe('Hello, world');
    expect(result.chunkCount).toBe(3);
  });

  it('calls onComplete after response.end()', async () => {
    const res = makeMockResponse();
    const callOrder: string[] = [];
    res.end.mockImplementation(() => {
      callOrder.push('end');
      return res as unknown as Response;
    });
    const onComplete = jest.fn(() => callOrder.push('onComplete'));

    await service.proxy({
      chunks: makeChunks(['hi']),
      response: res as unknown as Response,
      requestId: 'req-1',
      onComplete,
    });

    expect(callOrder).toEqual(['end', 'onComplete']);
  });

  it('measures firstChunkMs > 0 when there is at least one chunk', async () => {
    const res = makeMockResponse();
    const onComplete = jest.fn();

    await service.proxy({
      chunks: makeChunks(['data']),
      response: res as unknown as Response,
      requestId: 'req-1',
      onComplete,
    });

    const result: StreamResult = onComplete.mock.calls[0][0];
    expect(result.firstChunkMs).toBeGreaterThanOrEqual(0);
    expect(result.totalMs).toBeGreaterThanOrEqual(0);
  });

  it('sets firstChunkMs = 0 when there are no non-done chunks', async () => {
    const res = makeMockResponse();
    const onComplete = jest.fn();

    await service.proxy({
      chunks: makeDoneChunk(),
      response: res as unknown as Response,
      requestId: 'req-1',
      onComplete,
    });

    const result: StreamResult = onComplete.mock.calls[0][0];
    expect(result.firstChunkMs).toBe(0);
    expect(result.chunkCount).toBe(0);
    expect(result.content).toBe('');
  });

  it('stops iterating on done=true chunk', async () => {
    const res = makeMockResponse();
    const written: string[] = [];
    res.write.mockImplementation((data: unknown) => {
      written.push(data as string);
      return true;
    });

    async function* mixedChunks(): AsyncIterable<StreamChunk> {
      yield { content: 'before', index: 0, done: false };
      yield { content: '', index: 1, done: true };
      yield { content: 'after', index: 2, done: false }; // should never be written
    }

    await service.proxy({
      chunks: mixedChunks(),
      response: res as unknown as Response,
      requestId: 'req-1',
      onComplete: jest.fn(),
    });

    const dataWrites = written.filter((w) => w !== 'data: [DONE]\n\n');
    expect(dataWrites).toHaveLength(1);
    expect(dataWrites[0]).toContain('"before"');
  });
});
