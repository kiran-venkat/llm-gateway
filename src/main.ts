import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const nodeEnv = process.env.NODE_ENV ?? 'production';
  app.useGlobalFilters(new GlobalExceptionFilter(nodeEnv));

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
