require("dotenv/config");
const { PrismaClient } = require("@prisma/client");

async function main() {
  console.log("DATABASE_URL:", process.env.DATABASE_URL);
  console.log("PRISMA_CLIENT_ENGINE_TYPE:", process.env.PRISMA_CLIENT_ENGINE_TYPE);
  console.log("PRISMA_CLI_QUERY_ENGINE_TYPE:", process.env.PRISMA_CLI_QUERY_ENGINE_TYPE);
  console.log("PRISMA_ACCELERATE_URL:", process.env.PRISMA_ACCELERATE_URL);
  console.log("PRISMA_ENGINE_TYPE:", process.env.PRISMA_ENGINE_TYPE);
  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    console.log("Prisma connected OK");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("Prisma connect failed:", e);
  process.exit(1);
});

