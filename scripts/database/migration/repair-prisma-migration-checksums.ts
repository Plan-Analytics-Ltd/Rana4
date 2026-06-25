/**
 * Sync "_prisma_migrations".checksum with the SHA-256 of each local migration.sql
 * for migrations that are already recorded as applied.
 *
 * Fixes: "The migration `...` was modified after it was applied."
 *
 * Does NOT fix schema drift (missing/extra tables vs migration history). After this,
 * run `npm run db:reconcile-drift-sql` (needs SHADOW_DATABASE_URL), review the SQL,
 * apply with `npx prisma db execute --file ...`, then `npm run db:migrate`.
 *
 * Usage (repo root, DATABASE_URL in .env):
 *   npx tsx scripts/repair-prisma-migration-checksums.ts
 */
import "dotenv/config";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { PrismaClient } from "@prisma/client";

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required (e.g. from .env).");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const migrationsDir = path.join(process.cwd(), "prisma", "migrations");

  const rows = await prisma.$queryRaw<{ migration_name: string; checksum: string | null }[]>`
    SELECT migration_name, checksum
    FROM "_prisma_migrations"
    WHERE rolled_back_at IS NULL AND finished_at IS NOT NULL
  `;

  const dirs = fs
    .readdirSync(migrationsDir)
    .filter((d) => {
      const full = path.join(migrationsDir, d);
      return fs.statSync(full).isDirectory() && /^\d/.test(d);
    });

  let updated = 0;
  for (const dir of dirs) {
    const sqlPath = path.join(migrationsDir, dir, "migration.sql");
    if (!fs.existsSync(sqlPath)) continue;
    const row = rows.find((r) => r.migration_name === dir);
    if (!row) continue;

    const buf = fs.readFileSync(sqlPath);
    const checksum = crypto.createHash("sha256").update(buf).digest("hex");
    if (row.checksum === checksum) {
      console.log(`checksum OK  ${dir}`);
      continue;
    }

    await prisma.$executeRaw`
      UPDATE "_prisma_migrations"
      SET checksum = ${checksum}
      WHERE migration_name = ${dir}
    `;
    console.log(`checksum FIX ${dir}`);
    updated++;
  }

  await prisma.$disconnect();
  console.log(updated === 0 ? "No checksum updates needed." : `Updated ${updated} migration checksum(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
