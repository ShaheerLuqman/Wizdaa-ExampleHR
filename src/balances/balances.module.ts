import { Module } from '@nestjs/common';
import { BalanceWriterService } from './balance-writer.service';
import { BalancesController } from './balances.controller';
import { BalancesService } from './balances.service';

@Module({
  controllers: [BalancesController],
  providers: [BalancesService, BalanceWriterService],
  exports: [BalancesService, BalanceWriterService],
})
export class BalancesModule {}
