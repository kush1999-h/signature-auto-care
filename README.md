# Signature Auto Care MVP

Monorepo for a single-location service & repair shop.

- Next.js + Tailwind + React Query (apps/web)
- NestJS + MongoDB + JWT RBAC (apps/api)
- FastAPI PDF microservice (apps/py)
- Shared types/permissions (packages/shared)

## Requirements

- Node.js >= 20
- MongoDB (Atlas or local)
- Python 3.11+ (only for the PDF service)

## Environment variables

Copy examples and fill in real values:

```
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
cp apps/py/.env.example apps/py/.env
```

Required by service:

API (apps/api):
- MONGO_URI
- MONGO_DB
- JWT_SECRET
- JWT_REFRESH_SECRET
- BOOTSTRAP_SECRET
- ADMIN_SEED_EMAIL
- ADMIN_SEED_PASSWORD
- CORS_ORIGINS (comma-separated)
- PORT

Web (apps/web):
- NEXT_PUBLIC_API_URL
- NEXT_PUBLIC_PDF_URL

PDF (apps/py):
- JWT_SECRET
- API_URL
- CORS_ORIGINS
- PORT

## Quick start (local)

1. Install deps (from repo root):

```
npm install
```

2. Build shared package once:

```
npm run build --workspace packages/shared
```

3. Run everything with Docker:

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
```

> If `tsc` is not found when building shared, re-run `npm install` (TypeScript is pinned in root devDependencies).

### Handy port commands (Windows, PowerShell)

1. Find what's on a port (example: 3001)
   `netstat -ano -p tcp | findstr :3001`

2. Kill a PID you found (example PID 12345)
   `taskkill /PID 12345 /F`

3. One-liner to free a port (example: 3001)
   `(Get-NetTCPConnection -LocalPort 3001).OwningProcess | ForEach-Object { taskkill /PID $_ /F }`

## Production deployment (Render + Vercel)

API (Render, Docker):
- Dockerfile: `apps/api/Dockerfile`
- Port: 3001
- Set API env vars listed above

PDF service (Render, Docker):
- Dockerfile: `apps/py/Dockerfile`
- Port: 8001
- Set PDF env vars listed above

Web (Vercel):
- Root directory: `apps/web`
- Set `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_PDF_URL` before deploy

## Login

- Set `ADMIN_SEED_EMAIL` and `ADMIN_SEED_PASSWORD` to create the first owner/admin account at startup.
- Or call `/users/seed-initial-admin` with `BOOTSTRAP_SECRET` to generate initial access.

## Notes

- RBAC permissions/constants live in `packages/shared`.
- Critical inventory/payment flows use Mongo transactions (receive, issue to WO, counter sale, close invoice).
- Audit logging covers inventory, invoices/payments, expenses, work-order actions, and time logs.
- PDF endpoints return base64 payloads for invoices and profit reports (use reporting endpoints as data sources).
