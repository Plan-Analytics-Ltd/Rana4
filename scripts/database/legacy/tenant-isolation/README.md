# Legacy tenant-isolation recovery scripts

**Do not run these on a clean database.**

These SQL scripts exist only for recovering or reconciling **old** databases that pre-date company-scoped isolation. They may insert a hardcoded company:

- `id`: `default-company`
- `name`: `Default Company`

They are **not** part of normal Rana operation, onboarding, migrations, or `npm run dev`.

## Files

| File | Purpose |
|------|---------|
| `backfill-default-company.sql` | Create Default Company and assign null `company_id` rows |
| `reconcile-company-isolation.sql` | Idempotent structure + backfill for company isolation |

## When (if ever) to use

Only when restoring an antique database that still has null `company_id` columns and no other way to assign tenants. Prefer Prisma migrations and normal registration for any new environment.

## Related (active, not archived)

Generated drift reconcile SQL used by `npm run db:apply-reconcile*` remains under:

`scripts/database/reconcile/reconcile-to-migrations.*.sql`
