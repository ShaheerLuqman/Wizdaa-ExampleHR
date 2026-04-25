# Claude Build Guide: Time-Off Microservice (NestJS + SQLite)

## Build Goal
Implement a production-leaning Time-Off microservice that keeps ExampleHR request processing consistent with HCM as source of truth, while being resilient to sync drift and external failures.

## Architecture
- **API Layer (NestJS REST Controllers)**
  - Exposes RESTful endpoints with JSON-only request/response contracts.
- **Application Layer (Services)**
  - Orchestrates request lifecycle, balance checks, HCM calls, retries, and status transitions.
- **Domain Layer**
  - Contains entities, policies (insufficient balance, valid dimensions), and state machine logic.
- **Persistence Layer (SQLite + ORM)**
  - Stores balances, requests, sync events, idempotency keys.
- **Integration Layer (HCM Client)**
  - Realtime APIs and batch ingestion handlers.
- **Async Processing**
  - Retry worker + outbox processor for robust external synchronization.

## Suggested Stack
- NestJS
- SQLite
- Prisma
- Jest + Supertest for API/integration tests
- Lightweight mock HTTP server for HCM behavior simulation (deterministic + failure-mode scenarios)
- No Testcontainers (keep the test suite lightweight and fast)

## API Contract Rules
- Use RESTful APIs only.
- Use JSON API contracts only (`Content-Type: application/json`).
- Do not implement GraphQL endpoints.

## Data Contracts

### Time-off Request Input
- `employeeId: string`
- `locationId: string`
- `daysRequested: number` (positive decimal allowed if policy permits)
- `idempotencyKey: string` (required for safe retries/duplicate submit handling)

### Balance Record
- Composite key: `(employeeId, locationId)`
- `availableDays`
- `version`
- `lastSyncedAt`

### Request Statuses
- `PENDING`
- `APPROVED`
- `REJECTED`
- `FAILED_SYNC`
- `CANCELLED`

### Explicit State Transition Rules
- `PENDING -> APPROVED | REJECTED | FAILED_SYNC`
- `FAILED_SYNC -> APPROVED` (after successful async retry/outbox replay)
- Any transition not listed above is invalid and must be rejected by domain rules.

### Approval and Debit Policy
- Time-off request creation stores a `PENDING` request and does not debit HCM.
- Manager approval is required before debit.
- HCM debit is executed only during approval flow.

## Implementation Plan

### Phase 1: Project Setup
- Scaffold NestJS app.
- Configure SQLite connection and migrations.
- Create modules:
  - `time-off-requests`
  - `balances`
  - `hcm-integration`
  - `sync`
  - `health`

### Phase 2: Domain + Persistence
- Create schemas/entities:
  - `employee_balances`
  - `time_off_requests`
  - `idempotency_keys`
  - `outbox_events`
  - `sync_audit_logs`
- Add constraints:
  - Unique `(employeeId, locationId)` on balances.
  - Globally unique `idempotencyKey` (single unique constraint) to prevent duplicate execution across retries.
  - Version column on `employee_balances` for optimistic concurrency control.
- Add tenant scoping:
  - Include `tenantId` on all entities.
  - Scope all unique constraints and data access by `tenantId` where applicable.
- Keep request records and audit logs immutable (append-only behavior).

### Phase 3: Core Request and Approval Flows
- Implement `POST /time-off-requests`:
  1. Validate payload.
  2. Check idempotency.
  3. Perform local defensive balance check.
  4. Persist request as `PENDING` (no HCM debit at this step).
- Implement manager decision endpoint (for example `POST /v1/time-off-requests/:id/approve`):
  1. Validate request is in `PENDING`.
  2. Call HCM realtime validation/debit endpoint.
  3. On success, transition to `APPROVED`.
  4. On terminal HCM failure, keep `FAILED_SYNC` or reject based on policy.
  5. On transient HCM failure, mark `FAILED_SYNC` and enqueue outbox retry event.
- Implement rejection endpoint (for example `POST /v1/time-off-requests/:id/reject`):
  - Transition `PENDING -> REJECTED` without HCM debit.
- Ensure request state change + outbox event creation happen in one DB transaction (atomic write).
- Use optimistic concurrency (version match/update) for balance writes to avoid race-condition overwrites.
- On optimistic locking conflicts, retry up to 2 times, then return `409 Conflict`.
- Implement `GET /time-off-requests/:id`.
- Implement `GET /balances/:employeeId/:locationId`.

### Phase 4: Sync and Reconciliation
- Implement `POST /sync/hcm/batch`:
  - Overwrite local balances from HCM payload (HCM is source of truth).
  - Skip failed records, continue processing valid records, and log all failures/discrepancies in audit logs.
- Implement optional single-key reconcile endpoint:
  - `POST /sync/hcm/realtime/reconcile`.

### Phase 5: Reliability Patterns
- Add retry policy for transient HCM errors:
  - Maximum 5 attempts with exponential backoff.
  - After retries are exhausted, keep request in `FAILED_SYNC` for manual intervention.
- Add outbox table + worker:
  - Persist outbound sync intent atomically with request state in the same transaction.
  - Retry failed events asynchronously.
- Add idempotency for external calls (idempotency keys in headers or payload).
- Follow hybrid consistency model:
  - Synchronous HCM validation for user-facing operations.
  - Asynchronous outbox-based retries for reliability.
- Classify HCM errors:
  - Transient (retryable): triggers outbox retry.
  - Terminal (non-retryable): no retry.

### Phase 6: Observability
- Structured logs with request and correlation IDs.
- Metrics:
  - Request success/failure by status.
  - HCM latency/error rate.
  - Sync drift and reconciliation lag.
- Health endpoints:
  - Liveness/readiness.
- Performance target:
  - Sub-200ms internal latency target for non-HCM-blocked operations.

## Authentication and Multi-Tenancy
- Assume JWT-based authentication.
- Extract `tenantId` from JWT claims and enforce tenant isolation in all reads/writes.
- Reject cross-tenant access attempts.

## API Contracts and Versioning
- URL versioning required: `/v1/...`
- Pagination:
  - Use simple `limit` + `offset` pagination for list endpoints.
- Standard status codes:
  - `200` success
  - `201` created
  - `400` validation error
  - `409` conflict (idempotency/version)
  - `422` business rule failure
  - `500` internal error
- Standard error schema:
```json
{
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Not enough leave balance",
    "correlationId": "..."
  }
}
```

## Test Strategy (Critical for This Exercise)

### Unit Tests
- Domain policy tests:
  - Insufficient balance
  - Invalid dimensions
  - Status transition validity
- HCM client mapping/error translation.

### Integration Tests
- API-to-database behavior for all primary endpoints.
- Idempotency behavior with duplicate submissions.
- Concurrent request handling for same employee/location.
- Duplicate idempotency submissions return the original response without re-execution.
- Tenant isolation tests for all core endpoints.

### Contract/Mock Tests with HCM Simulator
- Realtime:
  - Valid debit
  - Insufficient balance
  - Invalid dimension
  - Timeout/intermittent failure
  - Deterministic transient vs terminal failure classification
- Batch:
  - Full upsert
  - Drift correction
  - Partial malformed record handling
  - Failed records skipped while batch continues

### End-to-End Scenarios
- Happy path request approval.
- Race condition: two near-simultaneous requests.
- External balance update then local reconcile.
- Retry recovery from temporary HCM outage.

### Coverage Guidance
- Minimum 80% coverage focused on domain and service layers.
- Include negative-path and resilience-path tests, not only success cases.

## Defensive Design Decisions
- Never rely only on local snapshot for final approval.
- Always treat HCM as canonical when committing leave deduction.
- Keep local data query-friendly but reconciliation-aware.
- Make operations idempotent to survive retries and duplicate client submits.
- Use optimistic locking on balances to protect concurrent request updates.
- Persist idempotency keys indefinitely.

## Alternative Approaches (to include in TRD)
- **Synchronous-only processing**
  - Simpler but less resilient to HCM instability.
- **Event-driven eventual consistency**
  - More scalable and resilient but higher operational complexity.
- **Hybrid (recommended)**
  - Sync for user-critical validation + async retry/outbox for reliability.

## Done Criteria
- All required endpoints implemented.
- Realtime + batch HCM sync supported.
- Defensive validation behavior implemented.
- Robust test suite with documented coverage.
- TRD includes challenge analysis and alternatives.
