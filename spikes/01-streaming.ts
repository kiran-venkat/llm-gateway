/**
 * Spike 01 — NestJS SSE streaming proof-of-concept
 *
 * Proves that NestJS SSE chunks arrive at the client in real time (not buffered).
 * Throwaway file — do not import or extend.
 *
 * Run:  npx ts-node spikes/01-streaming.ts
 * Test: curl -N http://localhost:3001/stream-test
 */

import { NestFactory } from '@nestjs/core';
import { Controller, Get, Module, Res } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import Anthropic from '@anthropic-ai/sdk';
import { Response } from 'express';
import * as dotenv from 'dotenv';

dotenv.config();

// ── Controller ────────────────────────────────────────────────────────────────

@Controller()
class StreamTestController {
  private readonly anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY?.trim(),
  });

  @Get('stream-test')
  async stream(@Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const stream = await this.anthropic.messages.stream({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: 'Write a haiku for each number 1 through 10. Label each one.' }],
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        res.write(`data: ${JSON.stringify({ content: event.delta.text })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  }
}

// ── Module ────────────────────────────────────────────────────────────────────

@Module({ controllers: [StreamTestController] })
class SpikeSpikeModule {}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(SpikeSpikeModule, {
    logger: ['error', 'warn'],
  });
  await app.listen(3001);
  console.log('Spike server running on http://localhost:3001');
  console.log('Run:  curl -N http://localhost:3001/stream-test');
}

bootstrap().catch(console.error);
