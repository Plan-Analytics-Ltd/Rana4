import { randomBytes } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Short join code for new companies and regeneration (signup flow). */
export function generateSignupJoinCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

type CompanyJoinDelegate = {
  findUnique: (args: {
    where: { joinCode: string };
    select?: { id: boolean };
  }) => Promise<{ id: string } | null>;
};

/** Reserves a unique short join code for `generateSignupJoinCode` collisions. */
export async function allocateUniqueSignupJoinCode(company: CompanyJoinDelegate): Promise<string> {
  for (let attempt = 0; attempt < 64; attempt++) {
    const joinCode = generateSignupJoinCode();
    const existing = await company.findUnique({
      where: { joinCode },
      select: { id: true },
    });
    if (!existing) return joinCode;
  }
  throw new Error("Could not allocate a unique join code");
}

/** Human-shareable company join code (uppercase, no ambiguous chars). */
export function generateJoinCode(length = 12): string {
  const buf = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[buf[i]! % ALPHABET.length];
  }
  return out;
}

export function normalizeJoinCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

type CompanyDelegate = {
  findUnique: (args: {
    where: { joinCode: string };
    select?: { id: boolean };
  }) => Promise<{ id: string } | null>;
};

/** Reserves a join code not present on any company row. */
export async function allocateCompanyJoinCode(company: CompanyDelegate): Promise<string> {
  for (let attempt = 0; attempt < 32; attempt++) {
    const joinCode = generateJoinCode();
    const existing = await company.findUnique({
      where: { joinCode },
      select: { id: true },
    });
    if (!existing) return joinCode;
  }
  throw new Error("Could not allocate a unique join code");
}
