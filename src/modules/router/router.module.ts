import { Module } from '@nestjs/common';
import { ProvidersModule } from '../providers/providers.module';
import { RouterRepository } from './router.repository';
import { RouterService } from './router.service';

@Module({
  imports: [ProvidersModule],
  providers: [RouterRepository, RouterService],
  exports: [RouterService],
})
export class RouterModule {}
