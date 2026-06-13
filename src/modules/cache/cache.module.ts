import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { RouterModule } from '../router/router.module';
import { CacheService } from './cache.service';
import { CacheInterceptor } from './cache.interceptor';

@Module({
  imports: [BullModule.registerQueue({ name: 'usage' }), RouterModule],
  providers: [CacheService, CacheInterceptor],
  exports: [CacheService, CacheInterceptor],
})
export class CacheModule {}
