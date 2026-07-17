# Cursor prompt: apply Batch 2 review corrections

Paste this to Cursor.

---

Apply the 25 reviewed decision corrections in `docs/brain-review-decisions-batch2.json` to the `EngineeringKnowledgeEntry` table, using the same `POST /dev/engineering-brain/review` endpoint (`src/controllers/engineeringBrainDiagnostics.controller.ts`) already used for the original 48-item import. This is a human-reviewed correction batch — every entry was checked against real activity evidence (see each entry's `evidence` field) before being included here, not an automatic acceptance of AI output.

(Note: a 25th entry — "Developed Design Schematics - Electrical", fingerprint `465215bbe047cea8fc55793a` — was added after the first dry-run reported 24/24 found. Please re-run the dry-run so it covers all 25 before confirming.)

**No LLM calls are involved in this step** — this only writes previously-reviewed decisions to the knowledge store, same as the original import script. Zero OpenAI cost.

Requirements:

1. **Merge, don't blind-overwrite.** For each entry, first read the existing `EngineeringKnowledgeEntry` row for that fingerprint. Only update the `identity` fields present in the batch file (`discipline`, `engineeringObject`, `engineeringWork`, `deliverableType`, `lifecycleStage`) — preserve the entry's existing `aliases` untouched (the batch file doesn't carry aliases, so don't overwrite them with `null`/empty). Append the batch file's `evidence`/`notes` to the entry's history rather than discarding prior evidence/notes.

2. **Action is `modify` for all 24** — these are corrections to existing DEVELOPER_MODIFIED/DEVELOPER_APPROVED decisions, not new approvals.

3. **Do not touch** the two fingerprints listed under `explicitlyExcluded` (VI-027, `7d8a17f1f0894951e60c96f5` — stays REJECTED) or `holdForHumanReview` (Retired Activities, `e67251f62aa3e4f0095ee7a0` — not decided yet). If the script encounters either of these, skip and log it, don't apply.

4. **Reuse the existing versionHistory mechanism** on `EngineeringKnowledgeEntry` (same as the original review import) so this shows up as a new version, not a silent field overwrite — consistent with how the first 48-item import was recorded.

5. **Dry-run first.** Print a diff (old identity -> new identity) for all 24 fingerprints without writing, then require explicit confirmation before actually calling the endpoint — same pattern as `scripts/backfill-engineering-reasoning.ts`'s `--confirm` flag.

6. **Report at the end**: how many of the 24 fingerprints were found and updated, any that weren't found (fingerprint mismatch would be a real bug worth surfacing, not silently skipping), and confirm the 2 excluded fingerprints were left untouched.

After this runs, the duration-stats Min/Avg/Max table should reflect these corrected identities on the next page load (no cache to clear beyond what already exists) — flag if that's not the case.
