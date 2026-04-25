import { Module } from '@nestjs/common';
import { HcmClient } from './hcm.client';

@Module({
  providers: [HcmClient],
  exports: [HcmClient],
})
export class HcmIntegrationModule {}
