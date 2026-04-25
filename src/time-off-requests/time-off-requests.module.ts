import { Module } from '@nestjs/common';
import { BalancesModule } from '../balances/balances.module';
import { HcmIntegrationModule } from '../hcm-integration/hcm-integration.module';
import { TimeOffRequestsController } from './time-off-requests.controller';
import { TimeOffRequestsService } from './time-off-requests.service';

@Module({
  imports: [BalancesModule, HcmIntegrationModule],
  controllers: [TimeOffRequestsController],
  providers: [TimeOffRequestsService],
  exports: [TimeOffRequestsService],
})
export class TimeOffRequestsModule {}
