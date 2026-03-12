# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   ├── api-server/         # Express API server
│   └── finance-tracker/    # Finance tracker React app
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts (single workspace package)
│   └── src/                # Individual .ts scripts
├── pnpm-workspace.yaml     # pnpm workspace
├── tsconfig.base.json      # Shared TS options
├── tsconfig.json           # Root TS project references
└── package.json            # Root package with hoisted devDeps
```

## Finance Tracker App

A Vietnamese finance tracker with:
- **Holdings**: Track stocks (e.g. VNM, HPG) and gold (SJC 1 lượng/1 chỉ)
- **Price Fetching**: Auto-fetches stock prices from SSI API, gold from SJC API every 15 minutes
- **Portfolio Summary**: Total value in VND with breakdown by asset type
- **7-day Chart**: Area chart of portfolio value history (recharts)
- **Database**: PostgreSQL with holdings, prices, and snapshots tables

### DB Schema (lib/db/src/schema/)
- `holdings` — user's asset holdings (type, symbol, quantity)
- `prices` — historical price records (type, symbol, price, change, fetchedAt)
- `snapshots` — daily portfolio value snapshots (totalValue, stockValue, goldValue)

### API Routes (artifacts/api-server/src/routes/)
- `GET /api/holdings` — list holdings
- `POST /api/holdings` — create holding
- `PUT /api/holdings/:id` — update quantity
- `DELETE /api/holdings/:id` — delete holding
- `GET /api/portfolio/summary` — get total value with latest prices
- `GET /api/prices/latest` — get latest price for each symbol
- `POST /api/prices/refresh` — trigger manual price refresh
- `GET /api/snapshots` — get last 7 days of portfolio snapshots

### Price Scheduler
The API server runs `startPriceScheduler()` on startup which:
1. Does an immediate initial fetch
2. Schedules a refetch every 15 minutes

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references.

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes live in `src/routes/` and use `@workspace/api-zod` for request and response validation and `@workspace/db` for persistence.

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL.

- `pnpm --filter @workspace/db run push` — push schema
- `pnpm --filter @workspace/db run push-force` — force push

### `lib/api-spec` (`@workspace/api-spec`)

OpenAPI 3.1 spec + Orval codegen config.

Run codegen: `pnpm --filter @workspace/api-spec run codegen`
