# Prisma (scheduling system)

- **Schema:** `schema.prisma` – **User** (auth), Standard, AssuranceNote, Fragnet, Activity, Relationship, Deliverable; UUID ids, relations, cascade, `RelationshipType` enum, unique `(fragnet_id, activity_code)`. Validate `best_duration` and `likely_duration` > 0 in app code.
- **Migrations:** `20250224120000_init`, `20250224120001_add_users`, `20250225000000_deliverables_fragnet_many_to_many`. Manual SQL fallback for `users`: `migrations/manual_users_table.sql`.

---

### Fix: “Drift detected” (e.g. you already created `users` in the DB)

If you ran the manual `users` table SQL in Neon and then run `npx prisma migrate dev`, Prisma reports drift because the DB has tables (e.g. `users`) that aren’t in the migration history.

**Option A – You already have the `users` table and want to keep data**

1. Tell Prisma that the migration that adds `users` is already applied (so drift goes away):
   ```bash
   npx prisma migrate resolve --applied "20250224120001_add_users"
   ```
2. Apply the remaining migrations (e.g. deliverables refactor):
   ```bash
   npx prisma migrate dev
   ```

**Option B – Reset the DB (all data will be lost)**

```bash
npx prisma migrate reset
```

Confirm when prompted. The DB will be recreated and all migrations (including `add_users` and deliverables) will run.

---

### Generate vs database updates (migrations do not run automatically)

- **`npx prisma generate`** – Only **regenerates the Prisma Client** (the code in `node_modules/.prisma`). It does **not** connect to the database and does **not** create or change tables. Run this after changing `schema.prisma` so your app code can use the new types and models.
- **`npx prisma db push`** – Pushes the current schema to the database (creates/updates tables). No migration history. Use for local/dev when you just want the DB to match the schema.
- **`npx prisma migrate dev`** – Creates a new migration file and applies it to the DB. Tracks migration history. Use when you want versioned migrations (e.g. for production or team workflow).

So: run **generate** after schema changes; run **db push** or **migrate dev** to actually create/update tables. Migrations do **not** run automatically on `prisma generate`.

---

### Fix: `EPERM` on `prisma generate`

Another process is locking the Prisma client DLL. Try in this order:

1. **Stop the dev server** – In the terminal where `npm run dev` is running, press **Ctrl+C**.
2. **Close all terminals** in Cursor/VS Code that use this project (they may load the client).
3. **Fully close Cursor/VS Code**, open a **new** PowerShell window, `cd` to the project, then run:
   ```bash
   npx prisma generate
   ```
   Then reopen the project. If it still fails, restart the PC and run generate before starting the dev server.

**If you need the `users` table before Prisma works:** run the SQL in **Neon SQL Editor** so auth (signup/login) works:

1. Open [Neon Console](https://console.neon.tech) → your project → **SQL Editor**.
2. Copy the contents of **`prisma/migrations/manual_users_table.sql`** and paste into the editor.
3. Run the query. That creates the `users` table. Once you get `prisma generate` to succeed, run `npx prisma db push` to keep schema in sync (or use migrations).

---

### Fix: `P1001: Can't reach database server`

Your `.env` still has the **placeholder** URL (`ep-xxx.region.aws.neon.tech`). Use your **real** Neon connection string:

1. Open [Neon Console](https://console.neon.tech) → your project → **Connection details**.
2. Copy the **connection string** (PostgreSQL, e.g. `postgresql://user:pass@ep-xxxx.us-east-1.aws.neon.tech/neondb?sslmode=require`).
3. In the project root, edit **`.env`** and set:
   ```env
   DATABASE_URL="postgresql://your-user:your-password@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require"
   ```
   (paste the string you copied; no `ep-xxx` placeholders.)

---

### Fix: “Drift detected” / schema not in sync

Your database already has tables (e.g. from `database/legacy-schema/apply_schema.sql`), but Prisma’s migration history doesn’t. Choose one:

**Option A – Keep existing DB and data (baseline)**  
Mark the initial migration as applied without running it:

```bash
npx prisma migrate resolve --applied "20250224120000_init"
```

Prisma will stop reporting drift. The DB stays as-is. If your SQL schema matches the Prisma schema (same tables/columns), you’re done. If you later see odd errors, consider Option B.

**Option B – Let Prisma own the schema (wipes DB)**  
Drop all data and reapply migrations so the DB matches Prisma exactly:

```bash
npx prisma migrate reset
```

Confirm when prompted. All data in the database will be lost.

---

### Apply migrations (Neon)

1. Set `DATABASE_URL` in `.env` to your real Neon connection string (see above).
2. Stop any running dev server (Ctrl+C in the terminal running `npm run dev`).
3. Run:
   ```bash
   npx prisma generate
   npx prisma migrate dev
   ```
   Use `migrate deploy` in production.
