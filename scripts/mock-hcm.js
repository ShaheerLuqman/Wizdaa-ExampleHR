"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_http_1 = require("node:http");
const port = Number(process.env.MOCK_HCM_PORT ?? 4001);
const server = (0, node_http_1.createServer)((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const mode = resolveMode(req.headers['x-hcm-mode'], url.searchParams.get('mode'));
    if (req.method === 'GET' && url.pathname === '/v1/hcm/balances') {
        return respondForMode(res, mode, () => ({
            availableDays: 13,
        }));
    }
    if (req.method === 'POST' && url.pathname === '/v1/hcm/time-off/debit') {
        let body = '';
        req.on('data', (chunk) => {
            body += chunk.toString();
        });
        req.on('end', () => {
            const parsed = body ? JSON.parse(body) : {};
            return respondForMode(res, mode, () => ({
                remainingDays: Math.max(0, 10 - Number(parsed.daysRequested ?? 0)),
            }));
        });
        return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: 'NOT_FOUND', message: 'Mock HCM route not found' }));
});
server.listen(port, () => {
    console.log(`Mock HCM listening on http://localhost:${port}`);
});
function resolveMode(header, query) {
    const raw = query ?? (Array.isArray(header) ? header[0] : header) ?? 'success';
    if (raw === 'success' ||
        raw === 'insufficient' ||
        raw === 'invalid' ||
        raw === 'transient_error') {
        return raw;
    }
    return 'success';
}
function respondForMode(res, mode, successBody) {
    if (mode === 'insufficient') {
        res.writeHead(422, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
            code: 'INSUFFICIENT_BALANCE',
            message: 'Not enough leave balance in HCM',
        }));
        return;
    }
    if (mode === 'invalid') {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
            code: 'INVALID_DIMENSION',
            message: 'Invalid employee/location dimension',
        }));
        return;
    }
    if (mode === 'transient_error') {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
            code: 'HCM_TEMPORARY_FAILURE',
            message: 'Mock transient HCM failure',
        }));
        return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(successBody()));
}
//# sourceMappingURL=mock-hcm.js.map