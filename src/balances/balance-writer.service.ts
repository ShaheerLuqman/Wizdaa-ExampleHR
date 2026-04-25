import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ApiErrorException } from '../common/api-error.exception';
import { PrismaService } from '../prisma/prisma.service';

type DbClient = PrismaService | Prisma.TransactionClient | PrismaClient;

@Injectable()
export class BalanceWriterService {
  constructor(private readonly prisma: PrismaService) {}

  async setAvailableDaysWithOptimisticRetry(input: {
    tenantId: string;
    employeeId: string;
    locationId: string;
    availableDays: number;
    tx?: DbClient;
  }) {
    const client = input.tx ?? this.prisma;

    for (let attempt = 0; attempt <= 2; attempt += 1) {
      const current = await client.employeeBalance.findUnique({
        where: {
          tenantId_employeeId_locationId: {
            tenantId: input.tenantId,
            employeeId: input.employeeId,
            locationId: input.locationId,
          },
        },
      });

      if (!current) {
        throw new ApiErrorException(
          'INVALID_DIMENSION',
          'No balance found for employee and location',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      const result = await client.employeeBalance.updateMany({
        where: {
          id: current.id,
          version: current.version,
        },
        data: {
          availableDays: input.availableDays,
          version: { increment: 1 },
          lastSyncedAt: new Date(),
        },
      });

      if (result.count === 1) {
        return client.employeeBalance.findUniqueOrThrow({
          where: { id: current.id },
        });
      }
    }

    throw new ApiErrorException(
      'VERSION_CONFLICT',
      'Balance was modified concurrently',
      HttpStatus.CONFLICT,
    );
  }
}
