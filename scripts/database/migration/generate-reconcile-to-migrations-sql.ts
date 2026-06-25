/**
 * Writes SQL that transforms the LIVE database toward the schema implied by
 * prisma/migrations (what `prisma migrate dev` expects after all migrations).
 *
 * Fixes drift such as: extra tables in DB, missing tables migrations define, etc.
 *
 * Requires:
 *   - DATABASE_URL — target database (e.g. Neon)
 *   - SHADOW_DATABASE_URL — any empty Postgres database (Neon branch is fine)
 *
 * Usage:
 *   npx tsx scripts/generate-reconcile-to-migrations-sql.ts
 *
 * Then review scripts/reconcile-to-migrations.generated.sql and apply:
 *   npm run db:apply-reconcile
 * (The script also prints this after a successful run.)
 */
import "dotenv/config";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import * as path from "node:path";

function main(): void {
  const db = process.env.DATABASE_URL;
  const shadow = process.env.SHADOW_DATABASE_URL;
  if (!db || !shadow) {
    console.error("Set DATABASE_URL and SHADOW_DATABASE_URL in .env (shadow = empty Postgres, e.g. a Neon branch).");
    process.exit(1);
  }

  /** Run Prisma without cmd.exe (`shell: true` breaks Neon URLs that contain `&channel_binding=...`). */
  const prismaCli = path.join(process.cwd(), "node_modules", "prisma", "build", "index.js");
  if (!existsSync(prismaCli)) {
    console.error(`Prisma CLI not found at ${prismaCli}. Run npm install.`);
    process.exit(1);
  }

  const out = path.join("scripts", "database", "reconcile", "reconcile-to-migrations.generated.sql");
  const r = spawnSync(
    process.execPath,
    [
      prismaCli,
      "migrate",
      "diff",
      "--from-url",
      db,
      "--to-migrations",
      "prisma/migrations",
      "--shadow-database-url",
      shadow,
      "--script",
      "-o",
      out,
    ],
    {
      cwd: process.cwd(),
      stdio: "inherit",
      shell: false,
      env: process.env,
    }
  );

  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
  const absOut = path.resolve(out);
  console.log("");
  console.warn(
    "IMPORTANT: This file may contain DROP TABLE for objects that exist in the DB but not in prisma/migrations/ " +
      "(e.g. legacy public.access_requests). Do NOT db execute blindly — remove any DROP you are not 100% sure about."
  );
  console.log("");
  console.log("Generated:", absOut);
  console.log("Then: open the file, review remaining statements, then:");
  console.log("");
  console.log("  npm run db:reconcile-no-drops");
  console.log("  npm run db:apply-reconcile-no-drops");
  console.log("");
  console.log("If migrate dev still reports public.access_requests as drift, add a new migration");
  console.log("whose SQL matches your live table (e.g. pg_dump --schema-only -t public.access_requests),");
  console.log("using CREATE TABLE IF NOT EXISTS so existing DBs skip create.");
  console.log("");
  console.log("Then: npm run db:migrate");
  console.log("");
}

main();
