/**
 * Introspects public.access_requests on DATABASE_URL and writes a Prisma migration
 * that recreates it with CREATE TABLE IF NOT EXISTS (+ indexes / FKs idempotently).
 *
 * Run once from repo root (same .env as Neon), then commit the new folder under prisma/migrations/:
 *   npx tsx scripts/emit-access-requests-baseline-migration.ts
 *
 * Then:
 *   npm run db:deploy
 *   (migrate dev refuses to run while drift exists; deploy applies pending migrations without that check.)
 *   npm run db:migrate
 */
import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { PrismaClient } from "@prisma/client";

type ColRow = {
  column_name: string;
  data_type: string;
  udt_name: string;
  udt_schema: string;
  character_maximum_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
  datetime_precision: number | null;
  is_nullable: string;
  column_default: string | null;
  ordinal_position: number;
};

function pgType(c: ColRow): string {
  const u = c.udt_name;
  const len = c.character_maximum_length;
  switch (u) {
    case "int2":
      return "SMALLINT";
    case "int4":
      return "INTEGER";
    case "int8":
      return "BIGINT";
    case "float4":
      return "REAL";
    case "float8":
      return "DOUBLE PRECISION";
    case "bool":
      return "BOOLEAN";
    case "text":
      return "TEXT";
    case "varchar":
    case "bpchar":
      return len != null ? `${u === "bpchar" ? "CHAR" : "VARCHAR"}(${len})` : "TEXT";
    case "date":
      return "DATE";
    case "timestamp":
      return c.datetime_precision != null
        ? `TIMESTAMP(${c.datetime_precision})`
        : "TIMESTAMP(3)";
    case "timestamptz":
      return c.datetime_precision != null
        ? `TIMESTAMPTZ(${c.datetime_precision})`
        : "TIMESTAMPTZ(6)";
    case "uuid":
      return "UUID";
    case "json":
      return "JSON";
    case "jsonb":
      return "JSONB";
    case "bytea":
      return "BYTEA";
    case "numeric":
      if (c.numeric_precision != null) {
        return c.numeric_scale != null && c.numeric_scale > 0
          ? `NUMERIC(${c.numeric_precision}, ${c.numeric_scale})`
          : `NUMERIC(${c.numeric_precision})`;
      }
      return "NUMERIC";
    default:
      if (u.startsWith("_")) {
        return `${pgType({ ...c, udt_name: u.slice(1) })}[]`;
      }
      if (c.udt_schema === "pg_catalog") {
        return `"${u}"`;
      }
      return `"${c.udt_schema}"."${u}"`;
  }
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL required");
    process.exit(1);
  }

  const migrationName = "20260515220000_baseline_public_access_requests";
  const outDir = path.join("prisma", "migrations", migrationName);
  const outFile = path.join(outDir, "migration.sql");

  if (fs.existsSync(outFile)) {
    console.error(`Refusing to overwrite ${outFile}. Delete that migration folder first if you need to regenerate.`);
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
      const exists = await prisma.$queryRaw<{ regclass: string }[]>`
        SELECT to_regclass('public.access_requests')::text AS regclass
      `;
      if (!exists[0]?.regclass || exists[0].regclass === "") {
        console.error("Table public.access_requests does not exist on this DATABASE_URL.");
        process.exit(1);
      }

      const cols = await prisma.$queryRaw<ColRow[]>`
        SELECT column_name, data_type, udt_name, udt_schema, character_maximum_length, numeric_precision, numeric_scale,
               datetime_precision, is_nullable, column_default, ordinal_position
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'access_requests'
        ORDER BY ordinal_position
      `;
      if (cols.length === 0) {
        console.error("No columns found for public.access_requests.");
        process.exit(1);
      }

      const pkCols = await prisma.$queryRaw<{ column_name: string }[]>`
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        WHERE tc.table_schema = 'public' AND tc.table_name = 'access_requests' AND tc.constraint_type = 'PRIMARY KEY'
        ORDER BY kcu.ordinal_position
      `;

      const colLines = cols.map((c) => {
        const t = pgType(c);
        const nn = c.is_nullable === "NO" ? " NOT NULL" : "";
        const def =
          c.column_default != null && c.column_default.trim() !== ""
            ? ` DEFAULT ${c.column_default}`
            : "";
        return `    "${c.column_name}" ${t}${nn}${def}`;
      });

      const pkNameRow = await prisma.$queryRaw<{ constraint_name: string }[]>`
        SELECT constraint_name
        FROM information_schema.table_constraints
        WHERE table_schema = 'public' AND table_name = 'access_requests' AND constraint_type = 'PRIMARY KEY'
        LIMIT 1
      `;
      const pkConstraintName = pkNameRow[0]?.constraint_name ?? "access_requests_pkey";

      let pkLine = "";
      if (pkCols.length > 0) {
        const names = pkCols.map((k) => `"${k.column_name}"`).join(", ");
        pkLine = `,\n    CONSTRAINT "${pkConstraintName.replace(/"/g, '""')}" PRIMARY KEY (${names})`;
      }

      const lines: string[] = [
        `-- Baseline: public.access_requests (introspected from DATABASE_URL).`,
        `-- Safe on DBs that already have the table (CREATE TABLE IF NOT EXISTS).`,
        ``,
        `CREATE TABLE IF NOT EXISTS "access_requests" (`,
        colLines.join(",\n"),
        pkLine,
        `);`,
        ``,
      ];

      const idxRows = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'access_requests'
        ORDER BY indexname
      `;
      for (const { indexname, indexdef } of idxRows) {
        if (indexname.endsWith("_pkey")) continue;
        const withIf = indexdef.replace(/^CREATE UNIQUE INDEX /i, "CREATE UNIQUE INDEX IF NOT EXISTS ").replace(/^CREATE INDEX /i, "CREATE INDEX IF NOT EXISTS ");
        lines.push(withIf + ";");
        lines.push("");
      }

      const fkRows = await prisma.$queryRaw<{ conname: string; def: string }[]>`
        SELECT con.conname, pg_get_constraintdef(con.oid) AS def
        FROM pg_constraint con
        INNER JOIN pg_class rel ON rel.oid = con.conrelid
        INNER JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        WHERE nsp.nspname = 'public' AND rel.relname = 'access_requests' AND con.contype = 'f'
        ORDER BY con.conname
      `;
      if (fkRows.length > 0) {
        lines.push(`DO $$`);
        lines.push(`BEGIN`);
        for (const { conname, def } of fkRows) {
          lines.push(`  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${conname.replace(/'/g, "''")}') THEN`);
          lines.push(`    ALTER TABLE "access_requests" ADD CONSTRAINT "${conname.replace(/"/g, '""')}" ${def};`);
          lines.push(`  END IF;`);
        }
        lines.push(`END $$;`);
        lines.push("");
      }

      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(outFile, lines.join("\n"), "utf8");
      console.log(`Wrote ${outFile}`);
      console.log("Next: npm run db:deploy   (applies this migration even while migrate dev reports drift)");
      console.log("Then: npm run db:migrate");
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
