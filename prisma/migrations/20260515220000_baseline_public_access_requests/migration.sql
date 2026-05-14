-- Baseline: public.access_requests (introspected from DATABASE_URL).
-- Safe on DBs that already have the table (CREATE TABLE IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS "access_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "requester_id" UUID,
    "table_name" TEXT,
    "reason" TEXT,
    "status" TEXT DEFAULT 'pending'::text,
    "created_at" TIMESTAMPTZ(6) DEFAULT now(),
    CONSTRAINT "access_requests_pkey" PRIMARY KEY ("id")
);
