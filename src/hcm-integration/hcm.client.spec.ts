import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { HcmClient } from './hcm.client';

describe('HcmClient', () => {
  let server: Server;
  let client: HcmClient;

  beforeEach(async () => {
    server = createServer((req, res) => {
      if (req.url === '/v1/hcm/time-off/debit' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk.toString();
        });
        req.on('end', () => {
          const parsed = JSON.parse(body) as { employeeId: string };
          if (parsed.employeeId === 'transient') {
            res.writeHead(503, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ code: 'HCM_TIMEOUT', message: 'retry' }));
            return;
          }
          if (parsed.employeeId === 'terminal') {
            res.writeHead(422, { 'content-type': 'application/json' });
            res.end(
              JSON.stringify({
                code: 'INSUFFICIENT_BALANCE',
                message: 'no balance',
              }),
            );
            return;
          }

          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ remainingDays: 7 }));
        });
        return;
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;
    process.env.HCM_BASE_URL = `http://127.0.0.1:${port}`;
    client = new HcmClient();
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('maps successful debits', async () => {
    await expect(
      client.debitTimeOff({
        tenantId: 'tenant-1',
        employeeId: 'emp-1',
        locationId: 'loc-1',
        daysRequested: 3,
        idempotencyKey: 'idem-1',
      }),
    ).resolves.toEqual({ ok: true, remainingDays: 7 });
  });

  it('classifies 5xx responses as transient', async () => {
    const result = await client.debitTimeOff({
      tenantId: 'tenant-1',
      employeeId: 'transient',
      locationId: 'loc-1',
      daysRequested: 3,
      idempotencyKey: 'idem-2',
    });

    expect(result).toMatchObject({
      ok: false,
      classification: 'TRANSIENT',
      code: 'HCM_TIMEOUT',
    });
  });

  it('classifies 4xx responses as terminal', async () => {
    const result = await client.debitTimeOff({
      tenantId: 'tenant-1',
      employeeId: 'terminal',
      locationId: 'loc-1',
      daysRequested: 3,
      idempotencyKey: 'idem-3',
    });

    expect(result).toMatchObject({
      ok: false,
      classification: 'TERMINAL',
      code: 'INSUFFICIENT_BALANCE',
    });
  });
});
