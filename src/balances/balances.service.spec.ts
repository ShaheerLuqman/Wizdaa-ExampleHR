import { ApiErrorException } from '../common/api-error.exception';
import { BalancesService } from './balances.service';

describe('BalancesService', () => {
  const findUnique = jest.fn();
  const prisma = {
    employeeBalance: {
      findUnique,
    },
  };
  const service = new BalancesService(prisma as never);

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns balance when present', async () => {
    findUnique.mockResolvedValueOnce({
      tenantId: 'tenant-a',
      employeeId: 'emp-1',
      locationId: 'loc-1',
      availableDays: 5,
    });

    await expect(
      service.getBalance({
        tenantId: 'tenant-a',
        employeeId: 'emp-1',
        locationId: 'loc-1',
      }),
    ).resolves.toMatchObject({ availableDays: 5 });
  });

  it('throws INVALID_DIMENSION when balance does not exist', async () => {
    findUnique.mockResolvedValueOnce(null);

    await expect(
      service.getBalance({
        tenantId: 'tenant-a',
        employeeId: 'missing',
        locationId: 'loc-1',
      }),
    ).rejects.toThrow(ApiErrorException);
  });
});
