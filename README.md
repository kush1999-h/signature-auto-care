# Signature Auto Care MVP

Monorepo for a single-location service & repair shop.

- Next.js + Tailwind + React Query (apps/web)
- NestJS + MongoDB + JWT RBAC (apps/api)
- FastAPI PDF microservice (apps/py)
- Shared types/permissions (packages/shared)

## Quick start

1. Install deps (from repo root):

```
npm install
```

2. Copy envs:

```
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
cp apps/py/.env.example apps/py/.env
```

3. Build shared package once (primes dist for all services):

```
npm run build --workspace packages/shared
```

4. Run everything with Docker:

```
docker compose up --build
```

- Web: http://localhost:3000
- API docs: http://localhost:3001/docs
- PDF svc: http://localhost:8001/health

## Local dev (without Docker)

Shell 1 (API 3001):

```
npm run dev:api
```

Shell 2 (Web 3000):

```
npm run dev:web
```

Shell 3 (FastAPI 8001):

```
cd apps/py
python -m uvicorn main:app --reload --port 8001
or
python -m uvicorn apps.py.main:app --reload --port 8001

```

> If `tsc` is not found when building shared, re-run `npm install` (TypeScript is pinned in root devDependencies).

### Handy port commands (Windows, PowerShell)

1. Find what's on a port (example: 3001)  
   `netstat -ano -p tcp | findstr :3001`

2. Kill a PID you found (example PID 12345)  
   `taskkill /PID 12345 /F`

3. One-liner to free a port (example: 3001)  
   `(Get-NetTCPConnection -LocalPort 3001).OwningProcess | ForEach-Object { taskkill /PID $_ /F }`

### Login

- Set `ADMIN_SEED_EMAIL` and `ADMIN_SEED_PASSWORD` to create the first owner/admin account at startup.
- Or call `/users/seed-initial-admin` with `BOOTSTRAP_SECRET` to generate initial access.

## Notes

- RBAC permissions/constants live in `packages/shared`.
- Critical inventory/payment flows use Mongo transactions (receive, issue to WO, counter sale, close invoice).
- Audit logging covers inventory, invoices/payments, expenses, work-order actions, and time logs.
- PDF endpoints return base64 payloads for invoices and profit reports (use reporting endpoints as data sources).
