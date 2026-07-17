# Backfill: Reasoned Identities for Existing Snapshot Data

Status: DRAFT — not yet implemented
Prerequisite (done): `AI_ENGINEERING_REASONING_ENABLED=true` now set in `.env`. Phase 1 and Phase 2 are live for all new activity going forward. This spec is specifically for the historical data that already exists in the database from imports that happened before this feature existed.

## 1. What this is

A standalone, one-time (but safely re-runnable) script that walks every existing `DeliverableSnapshot` row with `reasoningSource IS NULL` (i.e., captured before Phase 2 shipped, or captured while reasoning was off), reasons over it exactly the way `captureProgrammeSnapshot` now does for new imports, and writes the same `reasoned*` columns — so old data gets caught up without needing a full re-import.

This is not live request-handling code. It doesn't run inside `captureProgrammeSnapshot` or any API route. It's a script you run once (and can safely re-run if interrupted), same pattern as `scripts/verify-engineering-reasoning-phase2-capture.ts`.

## 2. Must report cost before spending it

We don't currently know how many `DeliverableSnapshot` rows exist in total across all projects/companies. Phase 2's real numbers (6 deliverables → 5,067 tokens, ~$0.026, 9.3s at whatever concurrency was used) give a per-deliverable estimate (~845 tokens, ~$0.004-0.005) but the total could be small or could be a few hundred — nobody's checked. So:

- **Step 1 (always runs, no side effects): count and estimate.** Query `COUNT(*)` of eligible rows (`reasoningSource IS NULL`, and only rows with enough data to reason over — same minimum-context requirements `captureProgrammeSnapshot` already applies), print the count, extrapolate an estimated total cost and estimated wall time at the chosen concurrency, and **stop** unless the script is explicitly run with a confirmation flag.
- **Step 2 (only with `--confirm` or `--execute`): actually run it.** Process in batches, write incrementally (so a crash after 200 of 500 rows leaves those 200 done and resumable, not rolled back), log running progress (processed / remaining / running cost so far) periodically rather than only at the end.

## 3. Scope: all companies, or just yours?

This is a multi-tenant app (every relevant query elsewhere in the codebase is scoped by `companyId`). Default the script to your company only (`DEV_PANEL_EMAIL`'s company, or accept an explicit `--companyId` argument) rather than silently processing every company in the database — this is your data decision to make for your own account, not something that should touch other companies' data by default without being asked to. Support an explicit `--all-companies` flag if truly wanted later, but that is **not** the default.

## 4. Mechanics

- Query eligible `DeliverableSnapshot` rows in pages (don't load the entire table into memory at once).
- For each, reconstruct the same kind of context `captureProgrammeSnapshot` builds today — linked `ActivitySnapshot` rows for that deliverable (same join pattern already used in `deliverableDurationStatisticsPresentation.service.ts`'s `activitiesByDeliverable` map), fragnet/WBS fields already on the row, and project context from the parent `ProgrammeSnapshot`/`ProjectIntelligenceProfile`.
- Reuse `buildEngineeringReasoningContextFromObserved()` and `runBoundedEngineeringReasoning()` (both already built) — but for this batch job, don't impose a short live-request-style time budget; a much larger budget (or no hard cutoff, just the existing concurrency cap doing the rate-limiting) is appropriate since nothing is blocking a page load. Keep the same concurrency cap constant though, or a deliberately-chosen slightly different one — don't hammer the OpenAI API harder than Phase 1/2 already validated as safe.
- Write `storedReasoningFieldsFromResult()` output (already built, already correctly nulls out rule-based fallbacks) back to each row via a batched update, not one write per row if that's avoidable.
- Skip (don't re-process) any row that already has `reasoningSource` set — this is what makes the script safely re-runnable after an interruption, and safe to run again later if you're ever unsure whether a prior run completed.

## 5. Output

At minimum, print: total eligible rows found, estimated cost/time (before running), and after running (if `--confirm`): rows processed, rows that got a real reasoned result vs. fell back to rule-based, total tokens, real total cost, total wall time, and any rows that errored (with enough detail to know which ones need a retry).

## 6. Testing

- Dry-run (no `--confirm`) makes zero writes — confirm this with a test that asserts no `DeliverableSnapshot` rows change when the script runs without confirmation.
- Running twice in a row: second run should find ~0 eligible rows (everything from the first run now has `reasoningSource` set) and do no additional LLM calls.
- A row with insufficient context to reason over meaningfully (e.g., no linked activities, no fragnet) — confirm it's either skipped with a clear reason logged, or falls back to rule-based and is recorded as such, not silently skipped without explanation.
