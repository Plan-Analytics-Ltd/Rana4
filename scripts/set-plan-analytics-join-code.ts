/**
 * Set a memorable join code for the company named "Plan Analytics" (case-insensitive match).
 *
 * Run from repo root (requires DATABASE_URL in .env):
 *   npx tsx scripts/set-plan-analytics-join-code.ts
 *
 * Optional: COMPANY_NAME (default "Plan Analytics") to match a different company display name.
 * Optional: CREATE_IF_MISSING=1 — if no row matches, create the company with the chosen join code.
 *
 * Stops if no matching company (unless CREATE_IF_MISSING) or if the preferred code is taken by another company.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { allocateCompanyJoinCode, normalizeJoinCode } from "../src/utils/joinCode.js";

const prisma = new PrismaClient();
const COMPANY_NAME = (process.env.COMPANY_NAME ?? "Plan Analytics").trim();
const CREATE_IF_MISSING = process.env.CREATE_IF_MISSING === "1" || process.env.CREATE_IF_MISSING === "true";
/** Preferred join code (uppercase, max 32 chars, unique). */
const PREFERRED = "PLANANALYTICS";

/** Pick preferred code for this company, or allocate if another company owns it. */
async function pickJoinCode(companyId: string | undefined): Promise<string> {
  let joinCode = normalizeJoinCode(PREFERRED);
  const owner = await prisma.company.findUnique({
    where: { joinCode },
    select: { id: true },
  });
  if (!owner) return joinCode;
  if (companyId && owner.id === companyId) return joinCode;
  joinCode = await allocateCompanyJoinCode(prisma.company);
  console.warn(`Preferred code ${PREFERRED} was taken by another company; assigned a random code instead.`);
  return joinCode;
}

async function main(): Promise<void> {
  const companies = await prisma.company.findMany({
    select: { id: true, name: true, joinCode: true },
  });
  let company = companies.find((c) => c.name.trim().toLowerCase() === COMPANY_NAME.toLowerCase());

  if (!company) {
    if (!CREATE_IF_MISSING) {
      console.error(
        `No company named "${COMPANY_NAME}" (case-insensitive). Create it first, set COMPANY_NAME, or run with CREATE_IF_MISSING=1.`,
      );
      process.exitCode = 1;
      return;
    }
    const joinCode = await pickJoinCode(undefined);
    const created = await prisma.company.create({
      data: { name: COMPANY_NAME, joinCode },
    });
    company = { id: created.id, name: created.name, joinCode: created.joinCode };
    console.log(`Created company "${company.name}" (${company.id}).`);
  } else {
    const joinCode = await pickJoinCode(company.id);
    await prisma.company.update({
      where: { id: company.id },
      data: { joinCode },
    });
    company = { ...company, joinCode };
  }

  console.log(`Company: ${company.name} (${company.id})`);
  console.log(`Join code: ${company.joinCode}`);
  console.log(`Signup link (local): http://localhost:3001/signup?code=${encodeURIComponent(company.joinCode)}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
