import { Injectable } from '@nestjs/common';
import { BalanceWriterService } from '../balances/balance-writer.service';
import { HcmClient, HcmSimulationMode } from '../hcm-integration/hcm.client';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertTransitionAllowed,
  RequestStatus,
} from '../time-off-requests/request-state';

@Injectable()
export class OutboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hcmClient: HcmClient,
    private readonly balanceWriter: BalanceWriterService,
  ) {}

  async processDueEvents(limit = 25, hcmMode?: HcmSimulationMode) {
    const events = await this.prisma.outboxEvent.findMany({
      where: {
        status: 'PENDING',
        nextAttemptAt: { lte: new Date() },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    let processed = 0;
    for (const event of events) {
      await this.processOne(event.id, hcmMode);
      processed += 1;
    }

    return { processed };
  }

  async processOne(eventId: string, hcmMode?: HcmSimulationMode) {
    const event = await this.prisma.outboxEvent.findUniqueOrThrow({
      where: { id: eventId },
    });

    if (event.type !== 'HCM_DEBIT_RETRY' || event.status !== 'PENDING') {
      return event;
    }

    const payload = JSON.parse(event.payload) as { requestId: string };
    const request = await this.prisma.timeOffRequest.findFirstOrThrow({
      where: {
        id: payload.requestId,
        tenantId: event.tenantId,
      },
    });

    assertTransitionAllowed(request.status, RequestStatus.Approved);

    const debit = await this.hcmClient.debitTimeOff({
      tenantId: event.tenantId,
      employeeId: request.employeeId,
      locationId: request.locationId,
      daysRequested: request.daysRequested,
      idempotencyKey: request.idempotencyKey,
      hcmMode,
    });

    if (!debit.ok) {
      const attempts = event.attempts + 1;
      const exhausted = attempts >= event.maxAttempts;

      return this.prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          attempts,
          status:
            exhausted || debit.classification === 'TERMINAL'
              ? 'EXHAUSTED'
              : 'PENDING',
          nextAttemptAt: new Date(
            Date.now() + Math.pow(2, attempts) * 1000,
          ),
          lastErrorCode: debit.code,
          lastErrorMessage: debit.message,
        },
      });
    }

    return this.prisma.$transaction(async (tx) => {
      await this.balanceWriter.setAvailableDaysWithOptimisticRetry({
        tenantId: event.tenantId,
        employeeId: request.employeeId,
        locationId: request.locationId,
        availableDays: debit.remainingDays,
        tx,
      });

      await tx.timeOffRequest.update({
        where: { id: request.id },
        data: {
          status: RequestStatus.Approved,
          failureCode: null,
          failureMessage: null,
        },
      });

      await tx.syncAuditLog.create({
        data: {
          tenantId: event.tenantId,
          eventType: 'OUTBOX_HCM_DEBIT_RETRY_APPROVED',
          employeeId: request.employeeId,
          locationId: request.locationId,
          requestId: request.id,
          details: 'Outbox retry succeeded; request approved.',
        },
      });

      return tx.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: 'COMPLETED',
          attempts: event.attempts + 1,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
    });
  }
}
