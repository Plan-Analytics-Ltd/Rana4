import { Prisma } from "@prisma/client";
import { prisma } from "../../utils/prisma.js";
import { getEncryptionKey } from "../security/secrets/index.js";

export type SecureDbClient = {
  $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>;
  $executeRaw(query: Prisma.Sql): Promise<number>;
};

export type EncryptedPayload = Buffer | Uint8Array;

function db(client?: SecureDbClient): SecureDbClient {
  return client ?? (prisma as unknown as SecureDbClient);
}

export async function encryptPayload(payload: unknown, client?: SecureDbClient): Promise<Buffer> {
  const jsonPayload = JSON.stringify(payload);
  if (jsonPayload === undefined) {
    throw new Error("Encrypted payload must be JSON serializable");
  }

  const rows = await db(client).$queryRaw<{ payload_enc: Buffer | Uint8Array }[]>(
    Prisma.sql`SELECT pgp_sym_encrypt(${jsonPayload}::text, ${getEncryptionKey()}) AS payload_enc`
  );
  const encrypted = rows[0]?.payload_enc;
  if (!encrypted) {
    throw new Error("Payload encryption failed");
  }
  return Buffer.isBuffer(encrypted) ? encrypted : Buffer.from(encrypted);
}

export async function decryptPayload<T>(payloadEnc: EncryptedPayload, client?: SecureDbClient): Promise<T> {
  const encrypted = Buffer.isBuffer(payloadEnc) ? payloadEnc : Buffer.from(payloadEnc);
  const rows = await db(client).$queryRaw<{ decrypted: string | null }[]>(
    Prisma.sql`SELECT pgp_sym_decrypt(${encrypted}::bytea, ${getEncryptionKey()}) AS decrypted`
  );
  const decrypted = rows[0]?.decrypted;
  if (typeof decrypted !== "string") {
    throw new Error("Payload decryption failed");
  }

  try {
    return JSON.parse(decrypted) as T;
  } catch {
    throw new Error("Decrypted payload is not valid JSON");
  }
}
