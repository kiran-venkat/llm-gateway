import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
