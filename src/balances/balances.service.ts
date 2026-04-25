import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiErrorException } from '../common/api-error.exception';

@Injectable()
export class BalancesService {
  constructor(private readonly prisma: PrismaService) {}

  async getBalance(input: {
    tenantId: string;
    employeeId: string;
    locationId: string;
  }) {
    const balance = await this.prisma.employeeBalance.findUnique({
      where: {
        tenantId_employeeId_locationId: {
          tenantId: input.tenantId,
          employeeId: input.employeeId,
          locationId: input.locationId,
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

    return balance;
  }
}
