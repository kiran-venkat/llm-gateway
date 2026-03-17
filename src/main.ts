// Polyfill crypto for Node 18 compatibility (Node 20 already has it)
if (!globalThis.crypto) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { webcrypto } = require('crypto');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  globalThis.crypto = webcrypto;
}

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync } from 'fs';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';

// Force-exit timeout: if graceful drain exceeds this, kill the process.
// Keeps BullMQ/Bull jobs from hanging shutdown indefinitely.
const SHUTDOWN_TIMEOUT_MS = 30_000;

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // Route OS shutdown signals through NestJS lifecycle hooks.
  // @nestjs/bull's BullModule implements OnModuleDestroy → queue.close(),
  // which waits for the currently-running job to finish before resolving.
  app.enableShutdownHooks();

  // Allow the dashboard dev server (and any configured origin) to call the API.
  // exposeHeaders lists the custom gateway headers the browser needs to read
  // from fetch() responses (X-Cache-Hit, X-Latency-Ms, etc.).
  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-No-Cache', 'X-Cache-Ttl', 'X-Tag'],
    exposedHeaders: [
      'X-Request-Id',
      'X-Cache-Hit',
      'X-Cache-Type',
      'X-Gateway-Provider',
      'X-Gateway-Model',
      'X-Latency-Ms',
      'X-Cost-Usd',
      'X-RateLimit-Remaining-Rpm',
      'X-RateLimit-Reset',
    ],
    credentials: false,
  });

  const nodeEnv = process.env.NODE_ENV ?? 'production';
  app.useGlobalFilters(new GlobalExceptionFilter(nodeEnv));
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  // ── OpenAPI / Swagger ────────────────────────────────────────────────────────
  const swaggerConfig = new DocumentBuilder()
    .setTitle('LLM Gateway API')
    .setDescription(
      'Production-grade API gateway for OpenAI, Anthropic, and Gemini. ' +
        'Handles routing, caching, rate limiting, and cost tracking.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'API Key' },
      'api-key',
    )
    .addTag('Gateway', 'LLM inference endpoints')
    .addTag('Analytics', 'Usage, cost, and cache statistics')
    .addTag('API Keys', 'Key management')
    .addTag('Providers', 'Provider configuration and status')
    .addTag('Health', 'Liveness and readiness probes')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  // Export spec as JSON for Postman import (non-production only).
  // openapi.json is written synchronously before the server starts so it's
  // always available at the project root after a dev boot.
  if (nodeEnv !== 'production') {
    writeFileSync('./openapi.json', JSON.stringify(document, null, 2));
    logger.log('OpenAPI spec written to openapi.json');
  }

  await app.listen(process.env.PORT ?? 3000);

  // Graceful shutdown handler shared by SIGTERM and SIGINT.
  // Order:
  //   1. Stop accepting new HTTP connections (app.close() calls server.close())
  //   2. @nestjs/bull OnModuleDestroy calls queue.close() on each Bull queue,
  //      which waits for the active job to complete before resolving
  //   3. Forced exit after SHUTDOWN_TIMEOUT_MS so a stuck job can't hang forever
  const shutdown = async (signal: string) => {
    logger.log(`${signal} received — draining jobs and closing server`);

    const forceExit = setTimeout(() => {
      logger.error(`Graceful shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms — forcing exit`);
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    // Prevent the timer from keeping the event loop alive after a clean shutdown
    forceExit.unref();

    try {
      await app.close();
      logger.log('Graceful shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error('Error during shutdown', err);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}
bootstrap();
