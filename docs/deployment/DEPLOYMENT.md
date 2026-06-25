# Production deployment

## Backend

- Set `NODE_ENV=production`.
- **JWT_SECRET**: Required; must be at least 32 characters. Generate with e.g. `openssl rand -base64 32`.
- **CORS_ORIGIN**: Comma-separated list of allowed frontend origins (e.g. `https://app.example.com`). If unset, CORS allows any origin (not recommended for production).
- **DATABASE_URL**: Your production PostgreSQL connection string (e.g. Neon).
- Run migrations: `npx prisma migrate deploy`.
- Optional: **ZEROBOUNCE_API_KEY** for email validation on signup.

## Frontend

- Set **NEXT_PUBLIC_API_URL** to your production backend URL (e.g. `https://api.example.com`). No trailing slash.

## Checklist

1. Backend: `NODE_ENV=production`, `JWT_SECRET` (≥32 chars), `CORS_ORIGIN`, `DATABASE_URL`.
2. Frontend: `NEXT_PUBLIC_API_URL` pointing to backend.
3. Backend: `npx prisma migrate deploy` before first run.
