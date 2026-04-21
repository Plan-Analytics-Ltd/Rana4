CREATE TABLE "admin_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "code" VARCHAR(32),
    "status" VARCHAR(24) NOT NULL,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_requests_code_key" ON "admin_requests"("code");

CREATE INDEX "admin_requests_user_id_idx" ON "admin_requests"("user_id");

CREATE INDEX "admin_requests_status_idx" ON "admin_requests"("status");

ALTER TABLE "admin_requests" ADD CONSTRAINT "admin_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
