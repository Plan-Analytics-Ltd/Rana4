SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname='public' AND tablename='activities'
ORDER BY indexname;
