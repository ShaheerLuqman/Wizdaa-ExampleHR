import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BalanceWriterService } from '../balances/balance-writer.service';
import { ApiErrorException } from '../common/api-error.exception';
import { isUniqueConstraintError } from '../common/prisma-error';
import { HcmClient, HcmSimulationMode } from '../hcm-integration/hcm.client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTimeOffRequestDto } from './dto/create-time-off-request.dto';
import {
  assertTransitionAllowed,
  RequestStatus,
} from './request-state';

type ServiceResponse = {
  statusCode: number;
  body: Record<string, unknown>;
};

@Injectable()
export class TimeOffRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hcmClient: HcmClient,
    private readonly balanceWriter: BalanceWriterService,
  ) {}

  async createPendingRequest(input: {
    tenantId: string;
    dto: CreateTimeOffRequestDto;
  }): Promise<ServiceResponse> {
    const existing = await this.prisma.idempotencyKey.findUnique({
      where: { key: input.dto.idempotencyKey },
    });

    if (existing) {
      if (existing.tenantId !== input.tenantId) {
        throw new ApiErrorException(
          'IDEMPOTENCY_CONFLICT',
          'Idempotency key belongs to a different tenant',
          HttpStatus.CONFLICT,
        );
      }

      return {
        statusCode: existing.responseCode,
        body: JSON.parse(existing.responseBody) as Record<string, unknown>,
      };
    }

    const balance = await this.prisma.employeeBalance.findUnique({
      where: {
        tenantId_employeeId_locationId: {
          tenantId: input.tenantId,
          employeeId: input.dto.employeeId,
          locationId: input.dto.locationId,
        },
      },
    });

    if (!balance) {
      throw new ApiErrorException(
        'INVALID_DIMENSION',
        'No balance found for employee and location',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    if (balance.availableDays < input.dto.daysRequested) {
      throw new ApiErrorException(
        'INSUFFICIENT_BALANCE',
        'Not enough leave balance',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const request = await tx.timeOffRequest.create({
          data: {
            tenantId: input.tenantId,
            employeeId: input.dto.employeeId,
            locationId: input.dto.locationId,
            daysRequested: input.dto.daysRequested,
            idempotencyKey: input.dto.idempotencyKey,
            status: RequestStatus.Pending,
          },
        });

        const body = { request };
        await tx.idempotencyKey.create({
          data: {
            key: input.dto.idempotencyKey,
            tenantId: input.tenantId,
            requestId: request.id,
            responseCode: HttpStatus.CREATED,
            responseBody: JSON.stringify(body),
          },
        });

        await tx.syncAuditLog.create({
          data: {
            tenantId: input.tenantId,
            eventType: 'TIME_OFF_REQUEST_CREATED',
            employeeId: request.employeeId,
            locationId: request.locationId,
            requestId: request.id,
            details: 'Pending request created; HCM debit deferred until approval.',
          },
        });

        return {
          statusCode: HttpStatus.CREATED,
          body,
        };
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const saved = await this.prisma.idempotencyKey.findUniqueOrThrow({
          where: { key: input.dto.idempotencyKey },
        });
        return {
          statusCode: saved.responseCode,
          body: JSON.parse(saved.responseBody) as Record<string, unknown>,
        };
      }

      throw error;
    }
  }

  async getRequest(input: { tenantId: string; requestId: string }) {
    const request = await this.prisma.timeOffRequest.findFirst({
      where: {
        tenantId: input.tenantId,
        id: input.requestId,
      },
    });

    if (!request) {
      throw new ApiErrorException(
        'NOT_FOUND',
        'Time-off request not found',
        HttpStatus.NOT_FOUND,
      );
    }

    return request;
  }

  async approve(input: {
    tenantId: string;
    requestId: string;
    correlationId?: string;
    hcmMode?: HcmSimulationMode;
  }) {
    const request = await this.getRequest(input);
    assertTransitionAllowed(request.status, RequestStatus.Approved);

    const debit = await this.hcmClient.debitTimeOff({
      tenantId: input.tenantId,
      employeeId: request.employeeId,
      locationId: request.locationId,
      daysRequested: request.daysRequested,
      idempotencyKey: request.idempotencyKey,
      correlationId: input.correlationId,
      hcmMode: input.hcmMode,
    });

    if (!debit.ok) {
      if (debit.classification === 'TRANSIENT') {
        return this.markFailedSyncAndEnqueueRetry({
          tenantId: input.tenantId,
          requestId: request.id,
          failureCode: debit.code,
          failureMessage: debit.message,
        });
      }

      return this.rejectAfterTerminalHcmFailure({
        tenantId: input.tenantId,
        requestId: request.id,
        failureCode: debit.code,
        failureMessage: debit.message,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      await this.balanceWriter.setAvailableDaysWithOptimisticRetry({
        tenantId: input.tenantId,
        employeeId: request.employeeId,
        locationId: request.locationId,
        availableDays: debit.remainingDays,
        tx,
      });

      const approved = await tx.timeOffRequest.update({
        where: { id: request.id },
        data: {
          status: RequestStatus.Approved,
          failureCode: null,
          failureMessage: null,
        },
      });

      await tx.syncAuditLog.create({
        data: {
          tenantId: input.tenantId,
          eventType: 'TIME_OFF_REQUEST_APPROVED',
          employeeId: request.employeeId,
          locationId: request.locationId,
          requestId: request.id,
          details: 'Manager approval completed and HCM debit succeeded.',
        },
      });

      return approved;
    });
  }

  async reject(input: {
    tenantId: string;
    requestId: string;
    reason?: string;
  }) {
    const request = await this.getRequest(input);
    assertTransitionAllowed(request.status, RequestStatus.Rejected);

    return this.prisma.$transaction(async (tx) => {
      const rejected = await tx.timeOffRequest.update({
        where: { id: request.id },
        data: {
          status: RequestStatus.Rejected,
          failureCode: 'MANAGER_REJECTED',
          failureMessage: input.reason ?? 'Request rejected by manager',
        },
      });

      await tx.syncAuditLog.create({
        data: {
          tenantId: input.tenantId,
          eventType: 'TIME_OFF_REQUEST_REJECTED',
          employeeId: request.employeeId,
          locationId: request.locationId,
          requestId: request.id,
          details: input.reason ?? 'Request rejected by manager',
        },
      });

      return rejected;
    });
  }

  private async markFailedSyncAndEnqueueRetry(input: {
    tenantId: string;
    requestId: string;
    failureCode: string;
    failureMessage: string;
  }) {
    const request = await this.getRequest(input);
    assertTransitionAllowed(request.status, RequestStatus.FailedSync);

    return this.prisma.$transaction(async (tx) => {
      const failed = await tx.timeOffRequest.update({
        where: { id: request.id },
        data: {
          status: RequestStatus.FailedSync,
          failureCode: input.failureCode,
          failureMessage: input.failureMessage,
        },
      });

      await tx.outboxEvent.create({
        data: {
          tenantId: input.tenantId,
          requestId: request.id,
          type: 'HCM_DEBIT_RETRY',
          status: 'PENDING',
          payload: JSON.stringify({ requestId: request.id }),
          attempts: 0,
          maxAttempts: 5,
          nextAttemptAt: new Date(),
          lastErrorCode: input.failureCode,
          lastErrorMessage: input.failureMessage,
        },
      });

      await tx.syncAuditLog.create({
        data: {
          tenantId: input.tenantId,
          eventType: 'TIME_OFF_REQUEST_FAILED_SYNC',
          employeeId: request.employeeId,
          locationId: request.locationId,
          requestId: request.id,
          details: input.failureMessage,
        },
      });

      return failed;
    });
  }

  private async rejectAfterTerminalHcmFailure(input: {
    tenantId: string;
    requestId: string;
    failureCode: string;
    failureMessage: string;
  }) {
    const request = await this.getRequest(input);
    assertTransitionAllowed(request.status, RequestStatus.Rejected);

    return this.prisma.timeOffRequest.update({
      where: { id: request.id },
      data: {
        status: RequestStatus.Rejected,
        failureCode: input.failureCode,
        failureMessage: input.failureMessage,
      },
    });
  }
}
