import { Module } from '@nestjs/common';
import { BalancesModule } from '../balances/balances.module';
import { HcmIntegrationModule } from '../hcm-integration/hcm-integration.module';
import { OutboxService } from './outbox.service';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({
  imports: [BalancesModule, HcmIntegrationModule],
  controllers: [SyncController],
  providers: [SyncService, OutboxService],
  exports: [SyncService, OutboxService],
})
export class SyncModule {}
