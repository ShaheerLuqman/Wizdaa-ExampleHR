import { Body, Controller, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Tenant } from '../auth/tenant.decorator';
import { TenantContext } from '../auth/tenant-context';
import { TenantGuard } from '../auth/tenant.guard';
import { HcmSimulationMode } from '../hcm-integration/hcm.client';
import { BatchSyncDto } from './dto/batch-sync.dto';
import { ReconcileDto } from './dto/reconcile.dto';
import { OutboxService } from './outbox.service';
import { SyncService } from './sync.service';

@Controller('v1/sync')
@UseGuards(TenantGuard)
export class SyncController {
  constructor(
    private readonly syncService: SyncService,
    private readonly outboxService: OutboxService,
  ) {}

  @Post('hcm/batch')
  ingestBatch(
    @Tenant() tenant: TenantContext,
    @Body() dto: BatchSyncDto,
    @Req() request: Request & { correlationId?: string },
  ) {
    return this.syncService.ingestBatch({
      tenantId: tenant.tenantId,
      records: dto.records,
      correlationId: request.correlationId,
    });
  }

  @Post('hcm/realtime/reconcile')
  reconcile(
    @Tenant() tenant: TenantContext,
    @Body() dto: ReconcileDto,
    @Req() request: Request & { correlationId?: string },
    @Query('mode') mode?: HcmSimulationMode,
  ) {
    return this.syncService.reconcileOne({
      tenantId: tenant.tenantId,
      employeeId: dto.employeeId,
      locationId: dto.locationId,
      correlationId: request.correlationId,
      hcmMode: mode ?? (request.header('x-hcm-mode') as HcmSimulationMode),
    });
  }

  @Post('outbox/process')
  processOutbox(
    @Req() request: Request,
    @Query('limit') limit?: string,
    @Query('mode') mode?: HcmSimulationMode,
  ) {
    return this.outboxService.processDueEvents(
      limit ? Number(limit) : 25,
      mode ?? (request.header('x-hcm-mode') as HcmSimulationMode),
    );
  }
}
