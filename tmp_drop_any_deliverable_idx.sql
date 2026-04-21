DO $$
DECLARE r record;
BEGIN
  FOR r IN (
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname='public'
      AND tablename='activities'
      AND indexdef ILIKE '%(deliverable_id%'
  ) LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I', r.indexname);
  END LOOP;
END $$;
