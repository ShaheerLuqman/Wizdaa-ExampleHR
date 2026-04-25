import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { execSync } from 'node:child_process';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ApiExceptionFilter } from '../src/common/api-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Time-off service API', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let hcmServer: Server;
  let retryOnceCalls = 0;

  beforeAll(async () => {
    process.env.DATABASE_URL = 'file:./test.db';

    hcmServer = createServer((req, res) => {
      if (req.url === '/v1/hcm/time-off/debit' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk.toString();
        });
        req.on('end', () => {
          const parsed = JSON.parse(body) as { employeeId: string };
          if (parsed.employeeId === 'retry-me') {
            res.writeHead(503, { 'content-type': 'application/json' });
            res.end(
              JSON.stringify({ code: 'HCM_TIMEOUT', message: 'try again' }),
            );
            return;
          }
          if (parsed.employeeId === 'retry-once' && retryOnceCalls === 0) {
            retryOnceCalls += 1;
            res.writeHead(503, { 'content-type': 'application/json' });
            res.end(
              JSON.stringify({ code: 'HCM_TIMEOUT', message: 'try again' }),
            );
            return;
          }

          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ remainingDays: 8 }));
        });
        return;
      }

      if (req.url?.startsWith('/v1/hcm/balances') && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ availableDays: 13 }));
        return;
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => hcmServer.listen(0, resolve));
    const port = (hcmServer.address() as AddressInfo).port;
    process.env.HCM_BASE_URL = `http://127.0.0.1:${port}`;

    execSync('npx prisma db push --skip-generate', {
      env: process.env,
      stdio: 'ignore',
    });

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();

    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    retryOnceCalls = 0;
    await prisma.outboxEvent.deleteMany();
    await prisma.idempotencyKey.deleteMany();
    await prisma.syncAuditLog.deleteMany();
    await prisma.timeOffRequest.deleteMany();
    await prisma.employeeBalance.deleteMany();
  });

  afterAll(async () => {
    await app.close();
    await new Promise<void>((resolve) => hcmServer.close(() => resolve()));
  });

  it('creates a pending request without debiting HCM, then debits on approval', async () => {
    await seedBalance('tenant-a', 'emp-1', 'loc-1', 10);

    const createResponse = await request(app.getHttpServer())
      .post('/v1/time-off-requests')
      .set('authorization', bearerToken('tenant-a'))
      .send({
        employeeId: 'emp-1',
        locationId: 'loc-1',
        daysRequested: 2,
        idempotencyKey: 'global-idem-1',
      })
      .expect(201);

    expect(createResponse.body.request.status).toBe('PENDING');
    const requestId = createResponse.body.request.id;

    const duplicateResponse = await request(app.getHttpServer())
      .post('/v1/time-off-requests')
      .set('authorization', bearerToken('tenant-a'))
      .send({
        employeeId: 'emp-1',
        locationId: 'loc-1',
        daysRequested: 2,
        idempotencyKey: 'global-idem-1',
      })
      .expect(201);

    expect(duplicateResponse.body.request.id).toBe(requestId);

    const approveResponse = await request(app.getHttpServer())
      .post(`/v1/time-off-requests/${requestId}/approve`)
      .set('authorization', bearerToken('tenant-a'))
      .send({})
      .expect(201);

    expect(approveResponse.body.status).toBe('APPROVED');

    const balance = await prisma.employeeBalance.findUniqueOrThrow({
      where: {
        tenantId_employeeId_locationId: {
          tenantId: 'tenant-a',
          employeeId: 'emp-1',
          locationId: 'loc-1',
        },
      },
    });
    expect(balance.availableDays).toBe(8);
  });

  it('marks approval as failed sync and enqueues outbox on transient HCM failure', async () => {
    await seedBalance('tenant-a', 'retry-me', 'loc-1', 10);

    const createResponse = await request(app.getHttpServer())
      .post('/v1/time-off-requests')
      .set('authorization', bearerToken('tenant-a'))
      .send({
        employeeId: 'retry-me',
        locationId: 'loc-1',
        daysRequested: 2,
        idempotencyKey: 'global-idem-2',
      })
      .expect(201);

    const approveResponse = await request(app.getHttpServer())
      .post(`/v1/time-off-requests/${createResponse.body.request.id}/approve`)
      .set('authorization', bearerToken('tenant-a'))
      .send({})
      .expect(201);

    expect(approveResponse.body.status).toBe('FAILED_SYNC');

    const event = await prisma.outboxEvent.findFirstOrThrow({
      where: { requestId: createResponse.body.request.id },
    });
    expect(event.status).toBe('PENDING');
    expect(event.maxAttempts).toBe(5);
  });

  it('recovers failed sync requests through the outbox processor', async () => {
    await seedBalance('tenant-a', 'retry-once', 'loc-1', 10);

    const createResponse = await request(app.getHttpServer())
      .post('/v1/time-off-requests')
      .set('authorization', bearerToken('tenant-a'))
      .send({
        employeeId: 'retry-once',
        locationId: 'loc-1',
        daysRequested: 2,
        idempotencyKey: 'global-idem-retry-once',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/v1/time-off-requests/${createResponse.body.request.id}/approve`)
      .set('authorization', bearerToken('tenant-a'))
      .send({})
      .expect(201);

    await request(app.getHttpServer())
      .post('/v1/sync/outbox/process')
      .set('authorization', bearerToken('tenant-a'))
      .expect(201);

    const savedRequest = await prisma.timeOffRequest.findUniqueOrThrow({
      where: { id: createResponse.body.request.id },
    });
    expect(savedRequest.status).toBe('APPROVED');

    const event = await prisma.outboxEvent.findFirstOrThrow({
      where: { requestId: savedRequest.id },
    });
    expect(event.status).toBe('COMPLETED');
  });

  it('isolates tenants and rejects cross-tenant request access', async () => {
    await seedBalance('tenant-a', 'emp-1', 'loc-1', 10);

    const createResponse = await request(app.getHttpServer())
      .post('/v1/time-off-requests')
      .set('authorization', bearerToken('tenant-a'))
      .send({
        employeeId: 'emp-1',
        locationId: 'loc-1',
        daysRequested: 2,
        idempotencyKey: 'global-idem-3',
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/v1/time-off-requests/${createResponse.body.request.id}`)
      .set('authorization', bearerToken('tenant-b'))
      .expect(404);
  });

  it('applies valid batch records and skips malformed records', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/sync/hcm/batch')
      .set('authorization', bearerToken('tenant-a'))
      .send({
        records: [
          { employeeId: 'emp-1', locationId: 'loc-1', availableDays: 12 },
          { employeeId: '', locationId: 'loc-2', availableDays: 3 },
        ],
      })
      .expect(201);

    expect(response.body).toEqual({ applied: 1, skipped: 1 });

    const auditCount = await prisma.syncAuditLog.count();
    expect(auditCount).toBe(2);
  });

  it('reconciles a local balance from realtime HCM balance lookup', async () => {
    await seedBalance('tenant-a', 'emp-1', 'loc-1', 4);

    const response = await request(app.getHttpServer())
      .post('/v1/sync/hcm/realtime/reconcile')
      .set('authorization', bearerToken('tenant-a'))
      .send({
        employeeId: 'emp-1',
        locationId: 'loc-1',
      })
      .expect(201);

    expect(response.body.availableDays).toBe(13);
    expect(response.body.version).toBe(2);
  });

  async function seedBalance(
    tenantId: string,
    employeeId: string,
    locationId: string,
    availableDays: number,
  ): Promise<void> {
    await prisma.employeeBalance.create({
      data: {
        tenantId,
        employeeId,
        locationId,
        availableDays,
      },
    });
  }
});

function bearerToken(tenantId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' }))
    .toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: 'manager-1', tenantId }))
    .toString('base64url');
  return `Bearer ${header}.${payload}.`;
}
