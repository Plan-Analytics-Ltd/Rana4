# Performance Optimization Pass

Status: DRAFT — not yet implemented. Findings from a full-repo audit (2026-07-17), one of them (the highest-impact) independently verified against source directly, not just trusted from the audit. All 8 are read-only findings — no behavior should change, only how fast/cheaply it's computed. No LLM/AI calls involved anywhere in this pass; purely mechanical, deterministic code changes.

General rule for every item below: same output, same test results, only faster. If a fix would change any actual matching/pooling/duration result, stop and flag it — don't silently ship a behavior change disguised as a perf fix.

## 1. Redundant candidate-identity recomputation (highest impact — duration-stats page load)

`src/services/deliverableDurationStatisticsPresentation.service.ts`, `computeStrictOriginalDurationItems()` (~L545-619). Verified directly: the function is `targets.map((target) => { ... for (snapshot of latestSnapshotByProject.values()) { deliverableSnapshots.flatMap(d => resolveCandidateIdentityFromSnapshot(...)) } })`. `resolveCandidateIdentityFromSnapshot` (L408) does taxonomy/regex resolution, `activityCodeDiscipline` computation, and knowledge-store lookup for a historical deliverable — none of which depends on `target`. Only `compareEngineeringIdentities(targetIdentity, candidateIdentity)` (L611) actually needs the target. Right now this expensive resolution reruns once per target × per historical deliverable — O(T×H) — when it only needs to happen once per historical deliverable — O(H) — plus a cheap O(T×H) comparison.

Fix: precompute `candidateIdentity` (and `fragnetName`, `deliverable` reference) once per historical deliverable, outside the `targets.map()` loop, keyed by a stable id (e.g. `deliverable.id` or `deliverableSnapshotId`). Build this cache once per call to `computeStrictOriginalDurationItems`, reuse it across all targets. The per-target loop then only does the comparison + basis calculation, not the resolution.

Test: existing duration-stats test suite must produce byte-identical results before/after (same Min/Avg/Max, same matched projects, same flags) — this is a pure performance refactor, verify with a diff of full output on the existing fixtures, not just "tests pass."

## 2. Regex recompilation in the taxonomy layer (same root cause as the already-fixed `canonicalizeToken` bug, found in more places)

Confirmed pattern recurring in:
- `src/services/intelligence/taxonomy/taxonomyMatching.utils.ts` — `patternMatches` and related helpers compile a fresh `RegExp` per rule per call (multiple call sites).
- `src/services/intelligence/taxonomy/disciplineClassifier.service.ts`
- `src/services/intelligence/taxonomy/documentType.extraction.ts` — `longestMatch`

These get called per-token/per-rule for every deliverable name resolved — which, combined with #1 above, means this cost was being paid far more often than necessary. Fix each the same way `nameSimilarity`'s `canonicalizeToken` should be fixed: precompile static patterns once at module load (a `Map`/array of compiled `RegExp` objects), never construct `RegExp` inside the hot comparison path.

Test: identity resolution regression tests (existing engineering identity / taxonomy test suites) must produce identical classifications before/after — this changes nothing about *which* pattern matches, only how the regex objects are constructed.

## 3. `historicalLearningRepair.service.ts` — serial per-row updates, no pagination

L69-152, L258-359: `for (const del of deliverableSnapshots) { await update(); await update(); await update(); }` against a `findMany` with no `take`. At current scale (~20 snapshots × up to ~2000 deliverables) this is a large number of fully serial DB round-trips in one run.

Fix: batch via `Promise.all` in bounded chunks (same chunking pattern already used in `scripts/apply-brain-review-batch2.ts`'s `writeReasonedBatch`, chunk size ~25) or a single `updateMany` where the update is uniform. Add a `take`/cursor page loop like the sibling `organisationKnowledge.service.ts` already does (`take: 500`).

Test: confirm identical rows get updated with identical values before/after, just faster and in fewer round-trips.

## 4. `revisionGrouping.service.ts` — O(D²·S) linear `.find()` inside a loop

L81-85: `project.deliverables.find(d => ...)` inside a `for (row of rows)` loop, run per historical row across all snapshots. Linear scan repeated per row instead of an O(1) lookup.

Fix: build a `Map` keyed by the same lookup key (fingerprint or deliverable id) once before the loop, replace `.find()` with `.get()`.

Test: same grouping output before/after on existing fixtures.

## 5. N+1 writes in schedule-recalculation hot path

`src/services/deliverableActivityChain.service.ts` L170-181 loops deliverables calling `syncDeliverableActivityLinkage` per item, each re-fetching context individually; `ensureActivityFsLink` (L45-66) does per-activity-pair `findFirst` + `create`. Similar in `deliverableRelationshipPropagation.service.ts` (L132-170) and `sharedActivityRelationshipBootstrap.service.ts` (L52-77). This runs on every schedule recalculation, a frequent operation.

Fix: batch-load all needed context once per recalculation, diff in memory, apply via bulk `createMany`/`updateMany` instead of per-item round trips.

Test: identical linkage/relationship state after recalculation, verified against current behavior on a real project's schedule recalc, not just unit fixtures — this one touches scheduling correctness directly, so be conservative and diff real output before/after on at least one real imported project.

## 6. Export controller re-decrypts rate card per row

`src/controllers/export.controller.ts` (L145-160, L458-482) → `rateCard.ts`'s `parseAndValidateAssignedResources`/`getRateCardEntries` re-fetches and re-decrypts the company's encrypted rate card once per row inside a `Promise.all(...map(...))`, despite it already being fetched once earlier for validation.

Fix: decrypt/parse once, thread the already-parsed rate card into the per-row mapping function instead of re-fetching.

Test: exported file output must be byte-identical before/after on the same project.

## 7. Missing index — `ActivitySnapshot.deliverableId`

`src/services/deliverableProjectEvolution.service.ts` L257-261, L289-293 queries `where: { snapshotId: { in }, deliverableId }` with no index covering `deliverableId`.

Fix: add `@@index([deliverableId, snapshotId])` to `ActivitySnapshot` in `prisma/schema.prisma`, generate the migration.

Test: standard migration safety check (additive index, no data change) — confirm existing queries still return identical rows, just faster on larger datasets.

## 8. Bulk activity delete — sequential per-id queries

`src/controllers/activities.controller.ts` L883-905: per-id `count` + `delete` + `auditLog` write in a loop for multi-select delete (~3 round trips × N selected items).

Fix: single `groupBy`/`count`, one `deleteMany`, one batched `auditLog.createMany`.

Test: confirm identical rows deleted and identical audit log entries created (same content, just written in fewer calls) before/after, on a multi-item delete.

## Explicitly checked and found clean (no action needed)

Route files (thin, no direct Prisma logic), `benchmark.service.ts`, `portfolioBenchmark.service.ts`, `deliverableFingerprint.service.ts`, `weightedDeliverableSimilarity.service.ts`, evidence diversity/selection services (already capped at 200), the learning-engine/lessons-learned services (already properly batched with `take: 500`), expected-duration/forecast-reliability services (linear stats only, no hot loops), and `EngineeringKnowledgeEntry`/`DeliverableKnowledgeProfile`/`RecommendationProfile` indexes (existing `@@unique`/`@@index` already match real query patterns).

## Order of operations

Do these one at a time, in order, verifying byte-identical output after each before moving to the next — not all at once. #1 and #2 are the highest-value and lowest-risk (pure refactor, no query changes). #7 (index) is safe and independent, can go anytime. #3, #4, #5, #6, #8 touch real write paths — be more careful, diff real output, not just "tests still pass."
