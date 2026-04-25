# Frontend Implementation Guide (API Test Console)

## Goal
Build a lightweight frontend that lets a user interactively test all backend APIs for the Time-Off microservice.

This FE is a functional test console, not a polished end-user product.

## Recommended Stack
- Framework: Next.js App Router (React + TypeScript)
- Rendering model: use client components for all interactive API panels
- Styling: CSS Modules only (scoped styles, no external UI dependency)
- HTTP: native `fetch` API only (no axios)
- State: local React state only, with `localStorage` persistence
- No global state library (no Redux/Zustand/MobX)

## App Structure
- `Auth / Context` section
- `Balances` section
- `Time-Off Requests` section
- `Approval & Rejection` section
- `Sync` section
- `Outbox` section
- `Health` section
- `Logs / History` section

## Environment Config
- `NEXT_PUBLIC_API_BASE_URL` (e.g. `http://localhost:3000`)
- Base URL comes from env by default, with optional per-request override in UI for debugging.
- Frontend dev server runs on `http://localhost:3001`.
- Backend runs on `http://localhost:3000` and must explicitly allowlist FE origin via CORS.

## Global UX Requirements
- Every request must support:
  - Method
  - URL
  - Headers
  - JSON body
  - Response status + JSON body display
- Show request + response panels side by side for debugging.
- Persist latest inputs per section in local storage.
- Include a global correlation ID field (optional override).
- If correlation ID is not provided, auto-generate one per request using `crypto.randomUUID()`.
- Show loading state while request is in-flight.
- Show execution time (ms) for every request.
- Measure request duration using `performance.now()`.
- Validate JSON payload client-side before sending; block request on invalid JSON.
- Add a `Copy as cURL` button for every request.

## Authentication and Tenant Handling
Backend expects a bearer token whose payload includes:
- `tenantId`
- `sub`

### FE Requirements
- Add fields:
  - `tenantId`
  - `subject` (default: `manager-1`)
- Add a `Generate Test JWT` button that creates an unsigned JWT-like token:
  - Header: `{ "alg": "none", "typ": "JWT" }`
  - Payload: `{ "sub": "...", "tenantId": "..." }`
- Attach `Authorization: Bearer <token>` on every protected API call.
- Store generated token in local storage for test convenience.
- Show warning text that this unsigned token flow is for local testing only and is not secure.
- Keep active tenant context always visible in the header.
- On tenant switch, show a clear notice that previous responses/assumptions may be invalid.

## API Sections and Forms

### 1) Health Section
#### Endpoints
- `GET /v1/health/live`
- `GET /v1/health/ready`

#### UI
- Two buttons: `Check Live`, `Check Ready`
- Show returned JSON.

---

### 2) Balances Section
#### Endpoint
- `GET /v1/balances/:employeeId/:locationId`

#### UI Inputs
- `employeeId`
- `locationId`

#### Button
- `Fetch Balance`

#### Expected outcomes
- `200` with balance object
- Error envelope for invalid dimensions or tenant mismatches

---

### 3) Time-Off Requests Section
#### Endpoint
- `POST /v1/time-off-requests`

#### UI Inputs
- `employeeId`
- `locationId`
- `daysRequested`
- `idempotencyKey` (manual + `Generate` button)

#### Button
- `Create Request`

#### Behavior
- Show created request (`PENDING` expected)
- If same `idempotencyKey` is used again, show duplicate replay response

---

### 4) Request Lookup Section
#### Endpoint
- `GET /v1/time-off-requests/:requestId`

#### UI Inputs
- `requestId`

#### Button
- `Fetch Request`

#### Behavior
- Show status transitions in UI badge:
  - `PENDING`
  - `APPROVED`
  - `REJECTED`
  - `FAILED_SYNC`
  - `CANCELLED`

---

### 5) Approval & Rejection Section
#### Endpoints
- `POST /v1/time-off-requests/:requestId/approve`
- `POST /v1/time-off-requests/:requestId/reject`

#### UI Inputs
- `requestId`
- `reason` (for rejection)

#### Buttons
- `Approve Request`
- `Reject Request`

#### Behavior
- On approve:
  - success => `APPROVED`
  - transient HCM failure => `FAILED_SYNC`
- On reject:
  - transition to `REJECTED` with optional reason

---

### 6) Batch Sync Section
#### Endpoint
- `POST /v1/sync/hcm/batch`

#### UI Input
- JSON editor for `records` array, example:
```json
{
  "records": [
    { "employeeId": "emp-1", "locationId": "loc-1", "availableDays": 12 },
    { "employeeId": "", "locationId": "loc-2", "availableDays": 3 }
  ]
}
```

#### Button
- `Run Batch Sync`

#### Behavior
- Show `{ applied, skipped }`
- Note that malformed records are skipped and logged

---

### 7) Realtime Reconcile Section
#### Endpoint
- `POST /v1/sync/hcm/realtime/reconcile`

#### UI Inputs
- `employeeId`
- `locationId`

#### Button
- `Run Reconcile`

#### Behavior
- Show updated balance payload from service

---

### 8) Outbox Processor Section
#### Endpoint
- `POST /v1/sync/outbox/process?limit=25`

#### UI Inputs
- `limit` (optional)

#### Button
- `Process Outbox`

#### Behavior
- Show `{ processed }`
- This is used to retry `FAILED_SYNC` requests
- Allow repeated execution and show cumulative processed count in the UI.
- Cumulative outbox counters are maintained per session and reset on page reload.

---

### 9) HCM Failure Simulation Section (Optional Controls)
These controls exist to speed up retry/recovery testing from FE.

#### Simulation Protocol Contract
- FE to mock HCM header:
  - `x-hcm-mode: success | insufficient | invalid | transient_error`
- Optional query override:
  - `?mode=transient_error`
- Behavior mapping:
  - `success` -> normal approval
  - `insufficient` -> `422`
  - `invalid` -> `400`
  - `transient_error` -> `500` or timeout

#### UI Controls
- `Failure Mode`: `success | insufficient | invalid | transient_error`
- Toggle: header mode vs query mode override
- `Apply for next request`

#### Behavior
- FE sends simulation headers/query params expected by the mock HCM server.
- Used to intentionally create:
  - transient failures for outbox retry validation
  - terminal failures for non-retry behavior validation

## Standard Headers in FE Client
- `Authorization: Bearer <token>`
- `Content-Type: application/json`
- `x-correlation-id` (manual override or auto-generated per request)

## Error Handling Contract
All error responses follow:
```json
{
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Not enough leave balance",
    "correlationId": "..."
  }
}
```

### FE Rendering Rules
- Show status code prominently.
- Render `error.code`, `error.message`, `error.correlationId` in alert box.
- Parse structured error response when possible.
- Always keep raw JSON response visible for debugging.

## API Status Code Reference
- `200`: success
- `201`: created / successful action
- `400`: validation/auth payload issues
- `409`: idempotency or optimistic-lock conflict
- `422`: business-rule failure
- `500`: internal/transient integration failure

## Suggested Frontend Routing
- `/` dashboard with collapsible API sections
- Optional segmented routes:
  - `/balances`
  - `/requests`
  - `/sync`
  - `/health`
- Pagination in list-style views uses `limit` + `offset`.

## Reusable FE Components
- `ApiPanel` (title, method, url, inputs, send button)
- `JsonEditor` (textarea + validate JSON)
- `ResponseViewer` (status + formatted JSON + duration)
- `StatusBadge` (PENDING/APPROVED/REJECTED/FAILED_SYNC/CANCELLED)
- `AuthBar` (tenantId, subject, token generation)
- `TenantContextBanner` (current tenant + switch warning)
- `ScenarioRunner` (quick predefined flow execution)
- `CopyCurlButton` (copies fully formed request as cURL)

## Status Badge Mapping
- `PENDING` -> gray
- `APPROVED` -> green
- `REJECTED` -> red
- `FAILED_SYNC` -> orange
- `CANCELLED` -> dark gray

Request statuses must always use this fixed color mapping for quick visual recognition.

## Testing Scenarios in FE
- Create PENDING request, then approve to debit via HCM
- Duplicate submit with same idempotency key (replay)
- Trigger transient approval failure -> `FAILED_SYNC` -> process outbox -> `APPROVED`
- Reject pending request
- Batch sync with valid + malformed records
- Reconcile single balance
- Cross-tenant fetch attempt (use different token)

## Predefined Scenario Presets
- Fixed payload base:
```json
{
  "employeeId": "emp-1",
  "locationId": "loc-1",
  "idempotencyKey": "idem-123"
}
```
- `Happy Path Approval`: create -> approve -> verify balance
- `Insufficient Balance`: create/approve with `x-hcm-mode=insufficient`
- `Retry Scenario`: create -> force transient failure -> outbox process -> verify approved
- `Idempotency Replay`: create -> duplicate submit -> compare responses
- `Terminal Failure Path`: create -> force invalid/terminal failure -> verify non-retry behavior
- `Batch Partial Success`: send mixed valid/invalid records -> verify applied/skipped
- `Tenant Isolation`: create in tenant A -> fetch with tenant B -> verify denial

## Nice-to-Have Additions
- Request history table (persisted in localStorage, max 20 interactions per section)
- Export/import test payload presets
- One-click scenario runner for common flows
- Dark mode toggle

## Out of Scope (for first FE iteration)
- Full employee/manager product UX
- Role-based screens
- Production-grade auth integration
- Real-time websocket updates

## Definition of Done (FE)
- All backend APIs can be called from the UI
- Auth token and tenant switching work
- Request/response inspector works for each API
- Error envelope is rendered consistently
- Documented test scenarios are executable from UI
- Keyboard navigation works for all interactive controls.
- Visible focus indicators and acceptable color contrast are implemented for core elements.
