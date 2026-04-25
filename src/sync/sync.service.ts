import { HttpStatus, Injectable } from '@nestjs/common';
import { BalanceWriterService } from '../balances/balance-writer.service';
import { ApiErrorException } from '../common/api-error.exception';
import { HcmClient, HcmSimulationMode } from '../hcm-integration/hcm.client';
import { PrismaService } from '../prisma/prisma.service';
import { BatchBalanceRecord } from './dto/batch-sync.dto';

@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly balanceWriter: BalanceWriterService,
    private readonly hcmClient: HcmClient,
  ) {}

  async ingestBatch(input: {
    tenantId: string;
    records: BatchBalanceRecord[];
    correlationId?: string;
  }) {
    let applied = 0;
    let skipped = 0;

    for (const record of input.records) {
      if (!this.isValidRecord(record)) {
        skipped += 1;
        await this.auditSkippedRecord(input.tenantId, record, input.correlationId);
        continue;
      }

      const before = await this.prisma.employeeBalance.findUnique({
        where: {
          tenantId_employeeId_locationId: {
            tenantId: input.tenantId,
            employeeId: record.employeeId,
            locationId: record.locationId,
          },
        },
      });

      const balance = await this.prisma.employeeBalance.upsert({
        where: {
          tenantId_employeeId_locationId: {
            tenantId: input.tenantId,
            employeeId: record.employeeId,
            locationId: record.locationId,
          },
        },
        create: {
          tenantId: input.tenantId,
          employeeId: record.employeeId,
          locationId: record.locationId,
          availableDays: record.availableDays,
          version: 1,
          lastSyncedAt: new Date(),
        },
        update: {
          availableDays: record.availableDays,
          version: { increment: 1 },
          lastSyncedAt: new Date(),
        },
      });

      await this.prisma.syncAuditLog.create({
        data: {
          tenantId: input.tenantId,
          eventType: 'HCM_BATCH_BALANCE_APPLIED',
          employeeId: record.employeeId,
          locationId: record.locationId,
          beforeValue: before ? JSON.stringify(before) : null,
          afterValue: JSON.stringify(balance),
          details: 'Local balance overwritten by HCM batch sync.',
          correlationId: input.correlationId,
        },
      });

      applied += 1;
    }

    return { applied, skipped };
  }

  async reconcileOne(input: {
    tenantId: string;
    employeeId: string;
    locationId: string;
    correlationId?: string;
    hcmMode?: HcmSimulationMode;
  }) {
    const result = await this.hcmClient.getBalance(input);
    if (!result.ok) {
      throw new ApiErrorException(
        result.classification === 'TRANSIENT'
          ? 'HCM_TRANSIENT_FAILURE'
          : 'HCM_TERMINAL_FAILURE',
        result.message,
        result.classification === 'TRANSIENT'
          ? HttpStatus.INTERNAL_SERVER_ERROR
          : HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const balance = await this.balanceWriter.setAvailableDaysWithOptimisticRetry(
      {
        tenantId: input.tenantId,
        employeeId: input.employeeId,
        locationId: input.locationId,
        availableDays: result.availableDays,
      },
    );

    await this.prisma.syncAuditLog.create({
      data: {
        tenantId: input.tenantId,
        eventType: 'HCM_REALTIME_RECONCILE',
        employeeId: input.employeeId,
        locationId: input.locationId,
        afterValue: JSON.stringify(balance),
        details: 'Local balance reconciled with realtime HCM value.',
        correlationId: input.correlationId,
      },
    });

    return balance;
  }

  private isValidRecord(
    record: BatchBalanceRecord,
  ): record is Required<BatchBalanceRecord> {
    return (
      typeof record.employeeId === 'string' &&
      record.employeeId.length > 0 &&
      typeof record.locationId === 'string' &&
      record.locationId.length > 0 &&
      typeof record.availableDays === 'number' &&
      Number.isFinite(record.availableDays)
    );
  }

  private async auditSkippedRecord(
    tenantId: string,
    record: BatchBalanceRecord,
    correlationId?: string,
  ): Promise<void> {
    await this.prisma.syncAuditLog.create({
      data: {
        tenantId,
        eventType: 'HCM_BATCH_BALANCE_SKIPPED',
        details: JSON.stringify({
          reason: 'Malformed batch record',
          record,
        }),
        correlationId,
      },
    });
  }
}
