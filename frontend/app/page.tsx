'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './page.module.css';

type HttpMethod = 'GET' | 'POST';
type HcmMode = 'success' | 'insufficient' | 'invalid' | 'transient_error';

type ApiResult = {
  status?: number;
  durationMs?: number;
  body?: unknown;
  raw?: string;
  error?: string;
  correlationId?: string;
  curl?: string;
};

type HistoryItem = {
  id: string;
  method: HttpMethod;
  url: string;
  status?: number;
  durationMs?: number;
  body?: unknown;
  createdAt: string;
  replay: RequestConfig;
};

type RequestConfig = {
  method: HttpMethod;
  path: string;
  body?: unknown;
  section: string;
  hcmMode?: HcmMode;
  useQueryMode?: boolean;
};

const defaultApiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';

const defaultPayload = {
  employeeId: 'emp-1',
  locationId: 'loc-1',
  daysRequested: 2,
  idempotencyKey: 'idem-123',
};

const batchPayload = {
  records: [
    { employeeId: 'emp-1', locationId: 'loc-1', availableDays: 12 },
    { employeeId: '', locationId: 'loc-2', availableDays: 3 },
  ],
};

export default function Home() {
  const [tenantId, setTenantId] = useLocalStorage('tenant-id', 'tenant-a');
  const [subject, setSubject] = useLocalStorage('subject', 'manager-1');
  const [token, setToken] = useLocalStorage('jwt-token', '');
  const [correlationOverride, setCorrelationOverride] = useLocalStorage(
    'correlation-id',
    '',
  );
  const [tenantNotice, setTenantNotice] = useState('');
  const [hcmMode, setHcmMode] = useLocalStorage<HcmMode>(
    'hcm-mode',
    'success',
  );
  const [useQueryMode, setUseQueryMode] = useLocalStorage(
    'hcm-query-mode',
    false,
  );
  const [lastResult, setLastResult] = useState<ApiResult>({});
  const [loadingSection, setLoadingSection] = useState('');
  const [history, setHistory] = useLocalStorage<Record<string, HistoryItem[]>>(
    'request-history',
    {},
  );
  const [outboxProcessed, setOutboxProcessed] = useState(0);
  const [historyExpanded, setHistoryExpanded] = useState(false);

  const [balanceEmployeeId, setBalanceEmployeeId] = useLocalStorage(
    'balance-employee-id',
    'emp-1',
  );
  const [balanceLocationId, setBalanceLocationId] = useLocalStorage(
    'balance-location-id',
    'loc-1',
  );
  const [createJson, setCreateJson] = useLocalStorage(
    'create-json',
    JSON.stringify(defaultPayload, null, 2),
  );
  const [requestId, setRequestId] = useLocalStorage('request-id', '');
  const [rejectReason, setRejectReason] = useLocalStorage(
    'reject-reason',
    'Manager rejected request',
  );
  const [batchJson, setBatchJson] = useLocalStorage(
    'batch-json',
    JSON.stringify(batchPayload, null, 2),
  );
  const [reconcileEmployeeId, setReconcileEmployeeId] = useLocalStorage(
    'reconcile-employee-id',
    'emp-1',
  );
  const [reconcileLocationId, setReconcileLocationId] = useLocalStorage(
    'reconcile-location-id',
    'loc-1',
  );
  const [outboxLimit, setOutboxLimit] = useLocalStorage('outbox-limit', '25');

  const effectiveToken = useMemo(
    () => token || createUnsignedJwt(subject, tenantId),
    [subject, tenantId, token],
  );

  function generateToken() {
    setToken(createUnsignedJwt(subject, tenantId));
  }

  function handleTenantChange(value: string) {
    setTenantId(value);
    setTenantNotice(
      'Tenant changed. Previous request IDs and responses may belong to a different tenant.',
    );
  }

  async function send(config: RequestConfig) {
    setLoadingSection(config.section);
    setTenantNotice('');

    const correlationId = correlationOverride || crypto.randomUUID();
    const path = buildPath(config.path, config.hcmMode, config.useQueryMode);
    const url = `${defaultApiBaseUrl.replace(/\/$/, '')}${path}`;
    const headers: Record<string, string> = {
      authorization: `Bearer ${effectiveToken}`,
      'content-type': 'application/json',
      'x-correlation-id': correlationId,
    };

    if (config.hcmMode && !config.useQueryMode) {
      headers['x-hcm-mode'] = config.hcmMode;
    }

    const init: RequestInit = {
      method: config.method,
      headers,
      body:
        config.method === 'POST' && config.body !== undefined
          ? JSON.stringify(config.body)
          : undefined,
    };

    const started = performance.now();
    const curl = toCurl(url, init);
    console.log('[FE] --> request', {
      section: config.section,
      method: config.method,
      url,
      headers,
      body: config.body ?? null,
      correlationId,
      hcmMode: config.hcmMode ?? null,
      transport: config.useQueryMode ? 'query' : 'header',
    });

    try {
      const response = await fetch(url, init);
      const raw = await response.text();
      const body = parseMaybeJson(raw);
      const durationMs = Math.round(performance.now() - started);
      const result = {
        status: response.status,
        durationMs,
        body,
        raw,
        correlationId,
        curl,
      };
      console.log('[FE] <-- response', {
        section: config.section,
        method: config.method,
        url,
        status: response.status,
        durationMs,
        correlationId,
        body,
      });

      setLastResult(result);
      addHistory(config.section, {
        id: crypto.randomUUID(),
        method: config.method,
        url,
        status: response.status,
        durationMs,
        body,
        createdAt: new Date().toISOString(),
        replay: config,
      });

      if (config.section === 'Outbox' && isRecord(body)) {
        setOutboxProcessed((current) => current + Number(body.processed ?? 0));
      }

      const maybeRequest = getRequestFromBody(body);
      if (maybeRequest?.id) {
        setRequestId(String(maybeRequest.id));
      }
    } catch (error) {
      const durationMs = Math.round(performance.now() - started);
      console.log('[FE] xx request_failed', {
        section: config.section,
        method: config.method,
        url,
        durationMs,
        correlationId,
        error: error instanceof Error ? error.message : 'Request failed',
      });
      setLastResult({
        error: error instanceof Error ? error.message : 'Request failed',
        durationMs,
        correlationId,
        curl,
      });
    } finally {
      setLoadingSection('');
    }
  }

  function addHistory(section: string, item: HistoryItem) {
    setHistory((current) => ({
      ...current,
      [section]: [item, ...(current[section] ?? [])].slice(0, 20),
    }));
  }

  function sendJson(config: Omit<RequestConfig, 'body'> & { json: string }) {
    const parsed = parseStrictJson(config.json);
    if (!parsed.ok) {
      setLastResult({ error: parsed.error });
      return;
    }

    void send({ ...config, body: parsed.value });
  }

  return (
    <main className={styles.page}>
      <div className={styles.workspace}>
        <div className={styles.leftPane}>
          <section className={styles.banner}>
            <h1 className={styles.title}>ExampleHR API Console</h1>
            <p className={styles.subtitle}>
              A lightweight frontend for testing every Time-Off microservice API,
              including tenant isolation, idempotency, HCM failure modes, sync,
              and outbox retry recovery.
            </p>
            <div className={styles.actions}>
              <span className={styles.pill}>Active tenant: {tenantId}</span>
              <span className={styles.pill}>Subject: {subject}</span>
            </div>
            {tenantNotice ? <div className={styles.warning}>{tenantNotice}</div> : null}
          </section>

          <section className={styles.banner} aria-label="Auth and context">
            <h2 className={styles.bannerTitle}>Auth / Tenant Context</h2>
            <div className={styles.grid}>
              <TextField
                label="Tenant ID"
                value={tenantId}
                onChange={handleTenantChange}
              />
              <TextField label="Subject" value={subject} onChange={setSubject} />
              <TextField
                label="Correlation ID Override"
                value={correlationOverride}
                onChange={setCorrelationOverride}
                placeholder="Blank = crypto.randomUUID()"
              />
            </div>
            <div className={styles.actions}>
              <button className={styles.button} onClick={generateToken}>
                Generate Test JWT
              </button>
              <button
                className={styles.secondaryButton}
                onClick={() => setCorrelationOverride(crypto.randomUUID())}
              >
                Generate Correlation ID
              </button>
              <span className={styles.pill}>Active tenant: {tenantId}</span>
            </div>
            <details className={styles.securityNote}>
              <summary>Security note</summary>
              Unsigned JWTs are generated client-side and stored locally for
              testing only. This is not a secure authentication mechanism.
            </details>
          </section>

          <Section
            title="HCM Simulation"
            description="Controls forwarded as x-hcm-mode header or ?mode query for deterministic mock HCM behavior."
          >
            <div className={styles.grid}>
              <SelectField
                label="HCM Mode"
                value={hcmMode}
                onChange={(value) => setHcmMode(value as HcmMode)}
                options={['success', 'insufficient', 'invalid', 'transient_error']}
              />
              <SelectField
                label="Transport"
                value={useQueryMode ? 'query' : 'header'}
                onChange={(value) => setUseQueryMode(value === 'query')}
                options={['header', 'query']}
              />
            </div>
          </Section>

          <Section title="Health" description="Check backend liveness/readiness.">
            <div className={styles.actions}>
              <ApiButton
                label="Check Live"
                section="Health"
                loadingSection={loadingSection}
                onClick={() => send({ method: 'GET', path: '/v1/health/live', section: 'Health' })}
              />
              <ApiButton
                label="Check Ready"
                section="Health"
                loadingSection={loadingSection}
                onClick={() => send({ method: 'GET', path: '/v1/health/ready', section: 'Health' })}
              />
            </div>
          </Section>

          <Section title="Balances" description="Fetch local balance snapshot by employee/location.">
            <div className={styles.grid}>
              <TextField label="Employee ID" value={balanceEmployeeId} onChange={setBalanceEmployeeId} />
              <TextField label="Location ID" value={balanceLocationId} onChange={setBalanceLocationId} />
            </div>
            <ApiButton
              label="Fetch Balance"
              section="Balances"
              loadingSection={loadingSection}
              onClick={() =>
                send({
                  method: 'GET',
                  path: `/v1/balances/${encodeURIComponent(balanceEmployeeId)}/${encodeURIComponent(balanceLocationId)}`,
                  section: 'Balances',
                })
              }
            />
          </Section>

          <Section title="Time-Off Requests" description="Create PENDING requests and test idempotency replay.">
            <JsonField value={createJson} onChange={setCreateJson} />
            <div className={styles.actions}>
              <ApiButton
                label="Create Request"
                section="Create Request"
                loadingSection={loadingSection}
                onClick={() =>
                  sendJson({
                    method: 'POST',
                    path: '/v1/time-off-requests',
                    section: 'Create Request',
                    json: createJson,
                  })
                }
              />
              <button
                className={styles.secondaryButton}
                onClick={() =>
                  setCreateJson(
                    JSON.stringify(
                      { ...defaultPayload, idempotencyKey: crypto.randomUUID() },
                      null,
                      2,
                    ),
                  )
                }
              >
                Generate Payload Key
              </button>
            </div>
          </Section>

          <Section title="Request Lookup" description="Fetch a request and inspect status.">
            <TextField label="Request ID" value={requestId} onChange={setRequestId} />
            <ApiButton
              label="Fetch Request"
              section="Request Lookup"
              loadingSection={loadingSection}
              onClick={() =>
                send({
                  method: 'GET',
                  path: `/v1/time-off-requests/${encodeURIComponent(requestId)}`,
                  section: 'Request Lookup',
                })
              }
            />
          </Section>

          <Section title="Approval & Rejection" description="Manager approval triggers HCM debit; rejection does not.">
            <div className={styles.grid}>
              <TextField label="Request ID" value={requestId} onChange={setRequestId} />
              <TextField label="Reject Reason" value={rejectReason} onChange={setRejectReason} />
            </div>
            <div className={styles.actions}>
              <ApiButton
                label="Approve Request"
                section="Approval"
                loadingSection={loadingSection}
                onClick={() =>
                  send({
                    method: 'POST',
                    path: `/v1/time-off-requests/${encodeURIComponent(requestId)}/approve`,
                    section: 'Approval',
                    body: {},
                    hcmMode,
                    useQueryMode,
                  })
                }
              />
              <ApiButton
                label="Reject Request"
                section="Rejection"
                loadingSection={loadingSection}
                onClick={() =>
                  send({
                    method: 'POST',
                    path: `/v1/time-off-requests/${encodeURIComponent(requestId)}/reject`,
                    section: 'Rejection',
                    body: { reason: rejectReason },
                  })
                }
              />
            </div>
          </Section>

          <Section title="Batch Sync" description="Push HCM balance corpus; malformed records are skipped/logged.">
            <JsonField value={batchJson} onChange={setBatchJson} />
            <ApiButton
              label="Run Batch Sync"
              section="Batch Sync"
              loadingSection={loadingSection}
              onClick={() =>
                sendJson({
                  method: 'POST',
                  path: '/v1/sync/hcm/batch',
                  section: 'Batch Sync',
                  json: batchJson,
                })
              }
            />
          </Section>

          <Section title="Realtime Reconcile" description="Refresh one employee/location balance from mock HCM.">
            <div className={styles.grid}>
              <TextField label="Employee ID" value={reconcileEmployeeId} onChange={setReconcileEmployeeId} />
              <TextField label="Location ID" value={reconcileLocationId} onChange={setReconcileLocationId} />
            </div>
            <ApiButton
              label="Run Reconcile"
              section="Realtime Reconcile"
              loadingSection={loadingSection}
              onClick={() =>
                send({
                  method: 'POST',
                  path: '/v1/sync/hcm/realtime/reconcile',
                  section: 'Realtime Reconcile',
                  body: {
                    employeeId: reconcileEmployeeId,
                    locationId: reconcileLocationId,
                  },
                  hcmMode,
                  useQueryMode,
                })
              }
            />
          </Section>

          <Section title="Outbox" description="Retry FAILED_SYNC requests. Counter resets on page reload.">
            <div className={styles.grid}>
              <TextField label="Limit" value={outboxLimit} onChange={setOutboxLimit} />
            </div>
            <div className={styles.actions}>
              <ApiButton
                label="Process Outbox"
                section="Outbox"
                loadingSection={loadingSection}
                onClick={() =>
                  send({
                    method: 'POST',
                    path: `/v1/sync/outbox/process?limit=${encodeURIComponent(outboxLimit)}`,
                    section: 'Outbox',
                    body: {},
                    hcmMode,
                    useQueryMode,
                  })
                }
              />
              <span className={styles.pill}>Session processed: {outboxProcessed}</span>
            </div>
          </Section>

          <Section title="Scenario Presets" description="Reproducible payload presets for quick validation.">
            <div className={styles.actions}>
              <button className={styles.secondaryButton} onClick={() => applyPreset('happy')}>
                Happy Path
              </button>
              <button className={styles.secondaryButton} onClick={() => applyPreset('insufficient')}>
                Insufficient Balance
              </button>
              <button className={styles.secondaryButton} onClick={() => applyPreset('retry')}>
                Retry Scenario
              </button>
            </div>
          </Section>
        </div>

        <aside className={styles.rightPane}>
          <Section title="Response Inspector" description="Latest request result, raw JSON, structured errors, and cURL.">
            <ResponseInspector result={lastResult} />
          </Section>

          <Section
            title="Request History"
            description="Up to 20 localStorage-backed interactions per section."
            actions={
              <button
                className={styles.iconButton}
                aria-label={historyExpanded ? 'Collapse request history' : 'Expand request history'}
                title={historyExpanded ? 'Collapse request history' : 'Expand request history'}
                onClick={() => setHistoryExpanded((current) => !current)}
              >
                <span
                  className={`${styles.chevron} ${historyExpanded ? styles.chevronOpen : ''}`}
                  aria-hidden="true"
                >
                  ▾
                </span>
              </button>
            }
          >
            {historyExpanded ? (
              <HistoryView history={history} onReplay={(config) => void send(config)} />
            ) : (
              <p>Request history is collapsed.</p>
            )}
          </Section>
        </aside>
      </div>
    </main>
  );

  function applyPreset(preset: 'happy' | 'insufficient' | 'retry') {
    const idempotencyKey =
      preset === 'happy'
        ? 'idem-123'
        : preset === 'insufficient'
          ? 'idem-insufficient'
          : 'idem-retry';

    setCreateJson(
      JSON.stringify(
        {
          ...defaultPayload,
          idempotencyKey,
          daysRequested: preset === 'insufficient' ? 99 : 2,
        },
        null,
        2,
      ),
    );
    setHcmMode(preset === 'retry' ? 'transient_error' : preset === 'insufficient' ? 'insufficient' : 'success');
  }
}

function Section({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        {actions}
      </div>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className={styles.field}>
      <label>{label}</label>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <div className={styles.field}>
      <label>{label}</label>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

function JsonField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const parsed = parseStrictJson(value);
  return (
    <div className={styles.field}>
      <label>JSON Body</label>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} />
      {!parsed.ok ? <div className={styles.error}>{parsed.error}</div> : null}
    </div>
  );
}

function ApiButton({
  label,
  section,
  loadingSection,
  onClick,
}: {
  label: string;
  section: string;
  loadingSection: string;
  onClick: () => void;
}) {
  const loading = loadingSection === section;
  return (
    <button className={styles.button} disabled={loading} onClick={onClick}>
      {loading ? 'Loading...' : label}
    </button>
  );
}

function ResponseInspector({ result }: { result: ApiResult }) {
  const structuredError = getStructuredError(result.body);
  const requestStatus = getRequestFromBody(result.body)?.status;

  return (
    <div className={styles.sectionBody}>
      <div className={styles.meta}>
        {result.status ? <span className={styles.pill}>HTTP {result.status}</span> : null}
        {result.durationMs !== undefined ? (
          <span className={styles.pill}>{result.durationMs} ms</span>
        ) : null}
        {result.correlationId ? (
          <span className={styles.pill}>correlation: {result.correlationId}</span>
        ) : null}
        {requestStatus ? <StatusBadge status={String(requestStatus)} /> : null}
      </div>
      {result.error ? <div className={styles.error}>{result.error}</div> : null}
      {structuredError ? (
        <div className={styles.error}>
          <strong>{structuredError.code}</strong>: {structuredError.message}
          <br />
          Correlation ID: {structuredError.correlationId}
        </div>
      ) : null}
      <div className={styles.twoColumn}>
        <div>
          <h3>Response JSON</h3>
          <pre className={styles.pre}>{formatJson(result.body ?? {})}</pre>
        </div>
        <div>
          <div className={styles.inlineHeading}>
            <h3>cURL</h3>
            {result.curl ? (
              <button
                className={styles.secondaryButton}
                onClick={() => navigator.clipboard.writeText(result.curl ?? '')}
              >
                Copy as cURL
              </button>
            ) : null}
          </div>
          <pre className={styles.pre}>{result.curl ?? ''}</pre>
        </div>
      </div>
      <div>
        <h3>Raw Response</h3>
        <pre className={styles.pre}>{result.raw ?? ''}</pre>
      </div>
    </div>
  );
}

function HistoryView({
  history,
  onReplay,
}: {
  history: Record<string, HistoryItem[]>;
  onReplay: (config: RequestConfig) => void;
}) {
  const items = Object.entries(history)
    .flatMap(([section, entries]) =>
      entries.map((entry) => ({
        ...entry,
        section,
      })),
    )
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

  if (items.length === 0) {
    return <p>No requests yet.</p>;
  }

  return (
    <div className={styles.history}>
      {items.map((item) => (
        <div className={styles.historyItem} key={item.id}>
          <span>
            <strong>{item.method}</strong> {item.url} - {item.status ?? 'n/a'} ({item.durationMs ?? 0} ms)
          </span>
          <button className={styles.secondaryButton} onClick={() => onReplay(item.replay)}>
            Replay
          </button>
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const className =
    status === 'APPROVED'
      ? styles.statusApproved
      : status === 'REJECTED'
        ? styles.statusRejected
        : status === 'FAILED_SYNC'
          ? styles.statusFailedSync
          : status === 'CANCELLED'
            ? styles.statusCancelled
            : styles.statusPending;

  return <span className={`${styles.statusBadge} ${className}`}>{status}</span>;
}

function useLocalStorage<T>(
  key: string,
  initialValue: T,
): [T, (value: T | ((current: T) => T)) => void] {
  const [value, setValue] = useState<T>(initialValue);

  useEffect(() => {
    const saved = window.localStorage.getItem(key);
    if (saved !== null) {
      setValue(JSON.parse(saved) as T);
    }
  }, [key]);

  const save = (next: T | ((current: T) => T)) => {
    setValue((current) => {
      const resolved =
        typeof next === 'function' ? (next as (current: T) => T)(current) : next;
      window.localStorage.setItem(key, JSON.stringify(resolved));
      return resolved;
    });
  };

  return [value, save];
}

function createUnsignedJwt(subject: string, tenantId: string): string {
  const header = base64UrlEncode({ alg: 'none', typ: 'JWT' });
  const payload = base64UrlEncode({ sub: subject, tenantId });
  return `${header}.${payload}.`;
}

function base64UrlEncode(value: unknown): string {
  return btoa(JSON.stringify(value))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function parseStrictJson(
  value: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(value) as unknown };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Invalid JSON',
    };
  }
}

function parseMaybeJson(value: string): unknown {
  if (!value) {
    return {};
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getRequestFromBody(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (isRecord(value.request)) {
    return value.request;
  }

  if (typeof value.status === 'string' && typeof value.id === 'string') {
    return value;
  }

  return undefined;
}

function getStructuredError(value: unknown) {
  if (!isRecord(value) || !isRecord(value.error)) {
    return undefined;
  }

  return {
    code: String(value.error.code ?? ''),
    message: String(value.error.message ?? ''),
    correlationId: String(value.error.correlationId ?? ''),
  };
}

function buildPath(path: string, mode?: HcmMode, useQueryMode?: boolean): string {
  if (!mode || !useQueryMode) {
    return path;
  }

  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}mode=${encodeURIComponent(mode)}`;
}

function toCurl(url: string, init: RequestInit): string {
  const headers = init.headers as Record<string, string>;
  const parts = [`curl -X ${init.method ?? 'GET'} "${url}"`];

  Object.entries(headers).forEach(([key, value]) => {
    parts.push(`  -H "${key}: ${value}"`);
  });

  if (init.body) {
    parts.push(`  -d '${String(init.body).replace(/'/g, "'\\''")}'`);
  }

  return parts.join(' \\\n');
}
