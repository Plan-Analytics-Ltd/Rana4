# Scheduling component schema

PostgreSQL schema for the scheduling component system: standards, fragnets, activities, relationships, assurance notes, and deliverables.

## Layout

```
database/legacy-schema/
├── README.md           (this file)
├── apply_schema.sql    (run this to create the full schema)
└── schema/
    ├── 00_extensions.sql   pgcrypto (gen_random_uuid)
    ├── 01_standards.sql    root entity
    ├── 02_assurance_notes.sql
    ├── 03_fragnets.sql
    ├── 04_activities.sql
    ├── 05_relationships.sql
    ├── 06_deliverables.sql
    └── 07_indexes.sql      indexes on all foreign keys
```

Files are ordered so dependencies are created first (extensions → tables → indexes).

## Apply the schema

From the project root:

```bash
psql -U your_user -d your_database -f database/legacy-schema/apply_schema.sql
```

Or from `database/legacy-schema/`:

```bash
psql -U your_user -d your_database -f apply_schema.sql
```

Extensions require superuser or database owner. Table and index creation can use a normal role with `CREATE` on the schema.

## Table overview

| Table             | Purpose |
|-------------------|--------|
| standards         | Root; name and description of a standard |
| assurance_notes    | Notes per standard; referenced by activities/deliverables |
| fragnets          | Fragment networks under a standard |
| activities        | Activities in a fragnet; unique (fragnet_id, activity_code) |
| relationships     | Predecessor–successor links (FS, SS, FF, SF) |
| deliverables      | Deliverables under a standard with duration estimates |

All primary keys are UUID with `gen_random_uuid()` default. Foreign keys have indexes for join and cascade performance.
