# Engineering Reasoning Phase 2 — Reasoned Identity on Historical Candidates

Status: DRAFT — not yet implemented
Builds on: `engineering-reasoning-activation-spec.md` (Phase 1, shipped and verified — target-only reasoning in duration stats, group-level reasoning in Brain diagnostics)

## 1. Why Phase 1 alone doesn't fully answer "use the AI for the numbers"

Phase 1 made the **target** deliverable's identity smarter. Every **historical candidate** it gets compared against is still resolved by the plain regex taxonomy — so an AI-reasoned target is still being matched against dumbly-resolved history. The actual pool of "what counts as equivalent past work" hasn't gotten any smarter; only one side of the comparison did.

Per the decision already made: the fix is not to have the AI invent duration numbers — Min/Avg/Max stay plain arithmetic over real, verifiable historical `originalDuration` values from actual past projects, so every figure still traces back to something that actually happened. The fix is to have the AI meaningfully involved in **which** historical deliverables get treated as equivalent evidence, on both sides of the comparison — not just the one being estimated today.

## 2. Why this must be pre-computed, not live

Confirmed by Phase 1's real numbers: ~5.1s average per `gpt-5.4` call. A duration-stats query compares one target against every deliverable in every other imported project's snapshot — that's potentially hundreds of candidates per single page load. Calling reasoning live for all of them, the way Phase 1 does for the (much smaller) target set, would blow past any reasonable request time budget. The only safe way to get AI-reasoned candidate identities is to compute them once, when a snapshot is captured, and store the result — so a duration-stats query reads pre-computed data instead of ever calling the LLM for historical candidates at query time.

## 3. Where this hooks in

`captureProgrammeSnapshot()` (`src/services/intelligence/shared/programmeSnapshotCapture.service.ts`) already does per-deliverable **async** work when building each `DeliverableSnapshot` row — see `enrichedDeliverables.map(async (d) => { const classification = await resolveDeliverableClassification(...); ... })`. This is the natural, already-async hook point to add one more `await` per deliverable for reasoning — it does not require converting anything from sync to async, unlike Phase 1's diagnostics/duration-stats hot paths.

## 4. Schema (additive only)

Add to `DeliverableSnapshot` (`prisma/schema.prisma`), all nullable, all additive:

```prisma
reasonedDiscipline        String?  @map("reasoned_discipline") @db.VarChar(64)
reasonedEngineeringObject String?  @map("reasoned_engineering_object") @db.VarChar(64)
reasonedEngineeringWork   String?  @map("reasoned_engineering_work") @db.VarChar(64)
reasonedDeliverableType   String?  @map("reasoned_deliverable_type") @db.VarChar(64)
reasonedLifecycleStage    String?  @map("reasoned_lifecycle_stage") @db.VarChar(64)
/// RULE_BASED | LLM_REASONED | LLM_MERGED | null (never computed — pre-dates this feature or reasoning was disabled at capture time)
reasoningSource           String?  @map("reasoning_source") @db.VarChar(16)
reasoningComputedAt       DateTime? @map("reasoning_computed_at")
```

Null on all reasoning fields must mean exactly one thing to every downstream reader: "fall back to the plain rule-based identity for this row, unchanged from today." No behavior may depend on these columns existing — same graceful-degradation discipline as `EngineeringKnowledgeEntry`.

## 5. Capture-time computation

In `captureProgrammeSnapshot`, alongside the existing `resolveDeliverableClassification` call per deliverable: if `isEngineeringReasoningActive()`, call `reasonEngineeringIdentity()` (via `runBoundedEngineeringReasoning`, reusing Phase 1's orchestrator — same concurrency cap and budget apply here too, just at import time instead of query time, where a longer budget is more acceptable since this isn't blocking a page load) using `buildEngineeringReasoningContextFromObserved()` (already built in Phase 1) with whatever activity/fragnet/context data is already being assembled for that deliverable in this function. Store the result's discipline/object/work/type/lifecycle ids and `source` in the new columns. If reasoning is inactive or a given item falls back to rule-based within budget, leave the reasoning columns null — don't store a "reasoned" result that's actually just the rule-based fallback relabeled.

## 6. Duration-stats consumption

In `deliverableDurationStatisticsPresentation.service.ts`, when building a candidate's `EngineeringIdentity` from a `HistoricalSnapshotInput.deliverableSnapshots` row: if `reasoningSource` is not null on that row, construct the candidate identity from the stored `reasoned*` fields (same component-building approach as `applyKnowledgeDecision` already uses for knowledge-store overrides) instead of calling `resolveEngineeringIdentity()` fresh. If null, behave exactly as today (rule-based, unchanged) — this is what makes it safe to ship without a backfill: old snapshots simply keep behaving as they do now, only newly-captured ones get the improvement.

Precedence stays the same as Phase 1 established: developer knowledge-store decision (if one exists for that fingerprint) still overrides everything, including a pre-computed reasoned candidate identity. Fingerprint computation for that lookup still uses the **rule-based** signature, not the reasoned one — same reason as before: that's how existing decisions were keyed, changing the basis would silently break every existing decision's lookup.

## 7. Explicitly not in this pass: backfilling existing snapshots

This only affects snapshots captured **after** this ships. Existing historical snapshots (your 2 current projects) keep their current rule-based candidate resolution until re-imported or until a deliberate backfill script is run. Don't build automatic backfill in this pass — flag it as an optional follow-up (a one-time batch job iterating existing `DeliverableSnapshot` rows, same bounded-orchestrator reuse, real but one-time cost) and let it be a conscious decision later, not a surprise cost triggered by this migration.

## 8. Testing

- Capture-time: confirm a newly captured snapshot populates the `reasoned*` columns when reasoning is active, and leaves them null when `AI_ENGINEERING_REASONING_ENABLED=false` (regression guard, same discipline as every other kill-switch test this project has built).
- Duration-stats: a case where a candidate's stored reasoned identity differs from what plain rule-based resolution of the same raw fields would produce — confirm the duration-stats matching uses the reasoned version, and falls back correctly when `reasoningSource` is null on an older row.
- Re-run the GET-Milestones-style scenario end to end: with both target **and** candidates now capable of carrying reasoned identities, confirm whether previously-pooled deliverables (Enabling Works, BWIC, etc.) actually separate into distinct comparison buckets when there's real historical data on both sides — report the real outcome, same as Phase 1's honesty about partial results.
- Cost/latency: report real capture-time numbers from an actual import — this cost is paid once per import rather than per page view, so a substantially larger per-import budget than Phase 1's 30s live-request budget is reasonable, but it should still be bounded and reported, not open-ended.
