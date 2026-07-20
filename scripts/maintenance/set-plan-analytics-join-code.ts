/**
 * Set a memorable join code for an existing company (default name: "Plan Analytics").
 *
 * Run from repo root (requires DATABASE_URL in .env):
 *   npx tsx scripts/maintenance/set-plan-analytics-join-code.ts
 *
 * Optional: COMPANY_NAME — case-insensitive match against an existing company display name.
 *
 * This script never creates companies. If no matching company exists, it exits with an error.
 * Create the company via normal registration / admin onboarding first.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { allocateCompanyJoinCode, normalizeJoinCode } from "../../src/utils/joinCode.js";

const prisma = new PrismaClient();
const COMPANY_NAME = (process.env.COMPANY_NAME ?? "Plan Analytics").trim();
/** Preferred join code (uppercase, max 32 chars, unique). */
const PREFERRED = "PLANANALYTICS";

/** Pick preferred code for this company, or allocate if another company owns it. */
async function pickJoinCode(companyId: string): Promise<string> {
  const joinCode = normalizeJoinCode(PREFERRED);
  const owner = await prisma.company.findUnique({
    where: { joinCode },
    select: { id: true },
  });
  if (!owner) return joinCode;
  if (owner.id === companyId) return joinCode;
  const allocated = await allocateCompanyJoinCode(prisma.company);
  console.warn(`Preferred code ${PREFERRED} was taken by another company; assigned a random code instead.`);
  return allocated;
}

async function main(): Promise<void> {
  const companies = await prisma.company.findMany({
    select: { id: true, name: true, joinCode: true },
  });
  const company = companies.find((c) => c.name.trim().toLowerCase() === COMPANY_NAME.toLowerCase());

  if (!company) {
    console.error(
      `No company named "${COMPANY_NAME}" (case-insensitive).\n` +
        `Create the company through normal Rana onboarding first, then re-run this script.\n` +
        `Or set COMPANY_NAME to match an existing company.`,
    );
    process.exitCode = 1;
    return;
  }

  const joinCode = await pickJoinCode(company.id);
  await prisma.company.update({
    where: { id: company.id },
    data: { joinCode },
  });

  console.log(`Company: ${company.name} (${company.id})`);
  console.log(`Join code: ${joinCode}`);
  console.log(`Signup link (local): http://localhost:3001/signup?code=${encodeURIComponent(joinCode)}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
