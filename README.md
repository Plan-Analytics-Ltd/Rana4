# Rana4

Enterprise planning and programme intelligence platform — schedule management, deliverable benchmarking, and AI-assisted explanations.

## Repository layout

| Path | Purpose |
|------|---------|
| `src/` | Express API backend (controllers, routes, services) |
| `frontend/` | Next.js web application |
| `prisma/` | PostgreSQL schema and migrations (production source of truth) |
| `database/` | Legacy SQL schema fragments (`legacy-schema/`) |
| `tests/` | Automated test suites (integration, security, adversarial, resilience) |
| `scripts/` | Operational scripts (validation, database, maintenance, utilities) |
| `tools/` | Developer utilities and archived debug scripts |
| `templates/` | XER and export templates |
| `docs/` | Architecture, deployment, security, testing, and API documentation |

## Key service areas (backend)

- `src/services/intelligence/` — Programme intelligence (benchmark, learning, prediction, trust, orchestration)
- `src/services/explanation/` — AI explanation layer (context, prompts, validation, providers)
- `src/services/integrations/` — External integrations (OpenAI, email)
- `src/services/scheduling/` — CPM scheduling engine
- `src/api/` — OpenAPI specification

## Quick start

```bash
# Backend
cp .env.example .env   # configure DATABASE_URL, secrets, etc.
npm install
npm run db:migrate
npm run dev            # API on port 3000

# Frontend (separate terminal)
cd frontend
cp .env.local.example .env.local
npm install
npm run dev            # UI on port 3001
```

## Documentation

- [Deployment](docs/deployment/DEPLOYMENT.md)
- [Testing](docs/testing/TESTING.md)
- [Operational security](docs/security/OPERATIONAL_SECURITY.md)
- [Project permissions](docs/architecture/PROJECT_PERMISSIONS.md)
- [API spec](docs/api/README.md)

## Validation

```bash
npm run build
npm run test:security
npm run test:tenant-isolation
npm run test:cpm-scheduler
npm run test:xer-regression
npm run validate:e2e
```

See [docs/testing/TESTING.md](docs/testing/TESTING.md) for the full test matrix.
