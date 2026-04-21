import { Prisma } from "@prisma/client";

export function isPrismaForeignKeyViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003";
}

