import { Injectable, Logger } from '@nestjs/common';
import { Response } from 'express';
import { StreamChunk } from '../../common/dto/stream-chunk.dto';

export interface StreamResult {
  content: string;
  chunkCount: number;
  firstChunkMs: number;
  totalMs: number;
}

export interface ProxyOptions {
  chunks: AsyncIterable<StreamChunk>;
  response: Response;
  requestId: string;
  onComplete: (result: StreamResult) => void;
}

@Injectable()
export class StreamService {
  private readonly logger = new Logger(StreamService.name);

  /**
   * Proxy an AsyncIterable<StreamChunk> to a client via SSE.
   *
   * - Sets SSE headers and flushes them before the first write so the client
   *   begins receiving data immediately (proven by Spike 01).
   * - Calls onComplete after response.end() so the client is never blocked
   *   by downstream bookkeeping (BullMQ enqueue, etc.).
   */
  async proxy(options: ProxyOptions): Promise<void> {
    const { chunks, response, requestId, onComplete } = options;
    const startMs = Date.now();
    let firstChunkMs: number | null = null;
    let chunkCount = 0;
    const contentParts: string[] = [];

    // Set SSE headers before any write — must happen before flushHeaders()
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders();

    try {
      for await (const chunk of chunks) {
        if (chunk.done) break;

        if (firstChunkMs === null) {
          firstChunkMs = Date.now() - startMs;
        }

        contentParts.push(chunk.content);
        chunkCount++;

        response.write(
          `data: ${JSON.stringify({
            id: requestId,
            choices: [
              { delta: { content: chunk.content }, index: chunk.index },
            ],
          })}\n\n`,
        );
      }
    } catch (err: unknown) {
      // Stream error: write a structured error event then close cleanly
      this.logger.error(`Stream error for request ${requestId}`, err);
      response.write(`data: ${JSON.stringify({ error: true })}\n\n`);
    }

    response.write('data: [DONE]\n\n');
    response.end();

    // onComplete fires after the client has their last byte
    onComplete({
      content: contentParts.join(''),
      chunkCount,
      firstChunkMs: firstChunkMs ?? 0,
      totalMs: Date.now() - startMs,
    });
  }
}
