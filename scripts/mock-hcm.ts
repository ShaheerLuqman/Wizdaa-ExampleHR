import { createServer, ServerResponse } from 'node:http';

type HcmMode = 'success' | 'insufficient' | 'invalid' | 'transient_error';

const port = Number(process.env.MOCK_HCM_PORT ?? 4001);

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const mode = resolveMode(req.headers['x-hcm-mode'], url.searchParams.get('mode'));
  const startedAt = Date.now();
  console.log(
    `[HCM] --> ${req.method ?? 'UNKNOWN'} ${url.pathname}${url.search} mode=${mode}`,
  );

  if (req.method === 'GET' && url.pathname === '/v1/hcm/balances') {
    return respondForMode(res, mode, startedAt, req.method ?? 'GET', `${url.pathname}${url.search}`, () => ({
      availableDays: 13,
    }));
  }

  if (req.method === 'POST' && url.pathname === '/v1/hcm/time-off/debit') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      const parsed = body ? (JSON.parse(body) as { daysRequested?: number }) : {};
      return respondForMode(
        res,
        mode,
        startedAt,
        req.method ?? 'POST',
        `${url.pathname}${url.search}`,
        () => ({
        remainingDays: Math.max(0, 10 - Number(parsed.daysRequested ?? 0)),
        }),
      );
    });
    return;
  }

  writeAndLog(res, 404, startedAt, req.method ?? 'UNKNOWN', `${url.pathname}${url.search}`);
  res.end(JSON.stringify({ code: 'NOT_FOUND', message: 'Mock HCM route not found' }));
});

server.listen(port, () => {
  console.log(`Mock HCM listening on http://localhost:${port}`);
});

function resolveMode(header: string | string[] | undefined, query: string | null): HcmMode {
  const raw = query ?? (Array.isArray(header) ? header[0] : header) ?? 'success';
  if (
    raw === 'success' ||
    raw === 'insufficient' ||
    raw === 'invalid' ||
    raw === 'transient_error'
  ) {
    return raw;
  }

  return 'success';
}

function respondForMode(
  res: ServerResponse,
  mode: HcmMode,
  startedAt: number,
  method: string,
  path: string,
  successBody: () => Record<string, unknown>,
) {
  if (mode === 'insufficient') {
    writeAndLog(res, 422, startedAt, method, path);
    res.end(
      JSON.stringify({
        code: 'INSUFFICIENT_BALANCE',
        message: 'Not enough leave balance in HCM',
      }),
    );
    return;
  }

  if (mode === 'invalid') {
    writeAndLog(res, 400, startedAt, method, path);
    res.end(
      JSON.stringify({
        code: 'INVALID_DIMENSION',
        message: 'Invalid employee/location dimension',
      }),
    );
    return;
  }

  if (mode === 'transient_error') {
    writeAndLog(res, 500, startedAt, method, path);
    res.end(
      JSON.stringify({
        code: 'HCM_TEMPORARY_FAILURE',
        message: 'Mock transient HCM failure',
      }),
    );
    return;
  }

  writeAndLog(res, 200, startedAt, method, path);
  res.end(JSON.stringify(successBody()));
}

function writeAndLog(
  res: ServerResponse,
  statusCode: number,
  startedAt: number,
  method: string,
  path: string,
) {
  res.writeHead(statusCode, { 'content-type': 'application/json' });
  const durationMs = Date.now() - startedAt;
  console.log(
    `[HCM] <-- ${method} ${path} status=${statusCode} durationMs=${durationMs}`,
  );
}
