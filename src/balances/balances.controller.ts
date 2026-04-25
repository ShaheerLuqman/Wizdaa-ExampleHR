import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { Tenant } from '../auth/tenant.decorator';
import { TenantContext } from '../auth/tenant-context';
import { TenantGuard } from '../auth/tenant.guard';
import { BalancesService } from './balances.service';

@Controller('v1/balances')
@UseGuards(TenantGuard)
export class BalancesController {
  constructor(private readonly balancesService: BalancesService) {}

  @Get(':employeeId/:locationId')
  getBalance(
    @Tenant() tenant: TenantContext,
    @Param('employeeId') employeeId: string,
    @Param('locationId') locationId: string,
  ) {
    return this.balancesService.getBalance({
      tenantId: tenant.tenantId,
      employeeId,
      locationId,
    });
  }
}
