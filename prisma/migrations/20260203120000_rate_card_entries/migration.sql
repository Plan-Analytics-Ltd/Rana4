-- CreateTable
CREATE TABLE "rate_card_entries" (
    "id" TEXT NOT NULL,
    "resource_type" VARCHAR(120) NOT NULL,
    "resource_name" VARCHAR(255) NOT NULL,
    "unit" VARCHAR(32) NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_card_entries_pkey" PRIMARY KEY ("id")
);
