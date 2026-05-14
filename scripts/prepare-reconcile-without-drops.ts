/**
 * Reads scripts/reconcile-to-migrations.generated.sql and writes
 * scripts/reconcile-to-migrations.no-drops.sql with all DROP TABLE lines removed.
 *
 * Use when Prisma diff wants to drop tables you still need (e.g. public.access_requests),
 * then: npm run db:apply-reconcile-no-drops
 *
 * Requires: npm run db:reconcile-drift-sql first.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const src = path.join("scripts", "reconcile-to-migrations.generated.sql");
const dst = path.join("scripts", "reconcile-to-migrations.no-drops.sql");

function main(): void {
  if (!fs.existsSync(src)) {
    console.error(`Missing ${src}. Run: npm run db:reconcile-drift-sql`);
    process.exit(1);
  }
  const raw = fs.readFileSync(src, "utf8");
  const lines = raw.split(/\r?\n/);
  const kept = lines.filter((line) => !/^\s*DROP\s+TABLE\b/i.test(line));
  const removed = lines.length - kept.length;
  fs.writeFileSync(dst, kept.join("\n"), "utf8");
  console.log(`Wrote ${dst}`);
  console.log(removed > 0 ? `Removed ${removed} DROP TABLE line(s).` : "No DROP TABLE lines found.");
}

main();
