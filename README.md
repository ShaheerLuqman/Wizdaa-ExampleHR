# ExampleHR Time-Off Service

NestJS + Prisma backend with a Next.js frontend console for testing time-off flows, HCM sync behavior, and outbox retries.

## Stack

- Backend: NestJS, Prisma, SQLite
- Frontend: Next.js (App Router)
- Runtime: Node.js

## Prerequisites

- Node.js 18+ (22 recommended)
- npm

## Setup

```bash
npm install
npm run prisma:generate
npm run prisma:migrate
```

## Run

### Start everything (recommended)

```bash
npm run start:all
```

This starts:

- Backend: `http://localhost:3000`
- Frontend: `http://localhost:3001`
- Mock HCM: `http://localhost:4001`

The start script also attempts to stop stale local stack processes before launching fresh ones.

### Start services individually

Backend:

```bash
npm run start:dev
```

Frontend:

```bash
npm run frontend:dev
```

Mock HCM:

```bash
npm run mock:hcm
```

## Environment

Copy or edit `.env` as needed. Common values:

- `PORT=3000`
- `FRONTEND_ORIGIN=http://localhost:3001`
- `HCM_BASE_URL=http://localhost:4001`
- `DATABASE_URL=file:./dev.db`

## Useful Scripts

- `npm run build` - build backend
- `npm run test` - run tests
- `npm run test:cov` - run tests with coverage
- `npm run prisma:generate` - generate Prisma client
- `npm run prisma:migrate` - run local migrations

## Notes

- The frontend includes an API console for triggering all backend endpoints.
- Request logs are emitted by backend middleware to help verify requests hit BE.
- If you see `EADDRINUSE`, stop stale local processes or rerun `npm run start:all`.
