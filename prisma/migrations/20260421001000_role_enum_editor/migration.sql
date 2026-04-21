-- Standardize Role enum to ADMIN / EDITOR / VIEWER
-- - Map legacy MEMBER -> EDITOR
-- - Recreate the Postgres enum type to remove MEMBER safely

DO $$
BEGIN
  -- Only run if Role is a Postgres enum type
  IF EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'Role'
      AND n.nspname = current_schema()
      AND t.typtype = 'e'
  ) THEN
    EXECUTE 'ALTER TYPE "Role" RENAME TO "Role_old"';
    EXECUTE 'CREATE TYPE "Role" AS ENUM (''ADMIN'', ''EDITOR'', ''VIEWER'')';

    -- Users.role
    EXECUTE '
      ALTER TABLE "users"
      ALTER COLUMN "role" DROP DEFAULT,
      ALTER COLUMN "role" TYPE "Role"
      USING (
        CASE WHEN "role"::text = ''MEMBER'' THEN ''EDITOR'' ELSE "role"::text END
      )::"Role"
    ';
    EXECUTE 'ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT ''VIEWER''';

    -- Invitations.role
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'invitations'
        AND column_name = 'role'
    ) THEN
      EXECUTE '
        ALTER TABLE "invitations"
        ALTER COLUMN "role" TYPE "Role"
        USING (
          CASE WHEN "role"::text = ''MEMBER'' THEN ''EDITOR'' ELSE "role"::text END
        )::"Role"
      ';
    END IF;

    -- Drop old type if no longer referenced
    BEGIN
      EXECUTE 'DROP TYPE "Role_old"';
    EXCEPTION WHEN dependent_objects_still_exist THEN
      -- If something else still references it, leave it in place.
      NULL;
    END;
  END IF;
END $$;

