import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { BalancesModule } from './balances/balances.module';
import { CorrelationMiddleware } from './common/correlation.middleware';
import { HcmIntegrationModule } from './hcm-integration/hcm-integration.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { SyncModule } from './sync/sync.module';
import { TimeOffRequestsModule } from './time-off-requests/time-off-requests.module';

@Module({
  imports: [
    PrismaModule,
    HcmIntegrationModule,
    BalancesModule,
    TimeOffRequestsModule,
    SyncModule,
    HealthModule,
  ],
  providers: [],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
