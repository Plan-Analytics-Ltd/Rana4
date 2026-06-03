import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const timeout = setTimeout(() => {
  console.error("TIMEOUT: no response from database within 15s");
  process.exit(2);
}, 15_000);

try {
  await p.$queryRaw`SELECT 1`;
  console.log("OK: database connection works");
} catch (e) {
  console.error("FAIL:", e?.code ?? "?", e?.message ?? e);
  process.exit(1);
} finally {
  clearTimeout(timeout);
  await p.$disconnect();
}
