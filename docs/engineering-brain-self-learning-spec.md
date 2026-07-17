# Engineering Brain — Self-Learning Spec

Status: DRAFT — not yet implemented
Author: Ahmed Elsaman (spec drafted by Claude, 2026-07-16)
Depends on: `EngineeringKnowledgeEntry` (existing), `engineeringReasoning.service.ts` (existing, currently disabled), `engineeringBrainDiagnostics.service.ts` (existing)

## 1. Problem

Today the Engineering Brain has two working layers and one broken link between them.

Layer 1, the deterministic taxonomy (`workPackageTaxonomy.data.ts`, `engineeringVocabulary.data.ts`, `documentType.extraction.ts`), decides identity by fixed regex/keyword rules. It only gets better when a developer hand-edits those files.

Layer 2, developer review decisions (`EngineeringKnowledgeEntry`, written via `POST /dev/engineering-brain/review`), memorize the exact outcome for one fingerprint (concept subject + resolved discipline|object|work signature) so that exact repeat never re-enters the review queue.

Between them, `computeEngineeringBrainDiagnostics` already aggregates unresolved concepts across every observed deliverable into `candidateLearning` — grouped by subject, counting occurrences and distinct projects — but that list is observation-only. Nothing reads it and nothing acts on it. A concept can appear 40 times across 6 projects, always resolving the same incomplete way, and the taxonomy never learns it.

This spec closes that gap: turn accumulated, cross-project evidence into draft taxonomy rules a developer can approve with one click, so the deterministic engine's actual coverage improves over time instead of just its memorized-decision cache.

## 2. What "self-learning" means here (and what it doesn't)

It means: the system notices when it has seen the same kind of gap enough times, with enough consistency, and enough human-confirmed ground truth backing it, to propose a permanent rule — and a human approves or rejects that proposal without writing any code.

It does not mean: the system silently edits its own source files, or an LLM free-associates new rules from a single ambiguous case. Per your answer to the auto-promotion question, every proposal sits in a review queue until a developer clicks "promote." That's a deliberate safety boundary — a bad auto-generalization from one messy project could otherwise misclassify every future project silently.

## 3. Architecture overview

```
Observed deliverables (existing)
        │
        ▼
candidateLearning aggregation (existing, engineeringBrainDiagnostics.service.ts)
        │
        ▼
NEW: Rule Proposal Engine
  - groups candidates using similarity, not just exact subject match
  - cross-references EngineeringKnowledgeEntry for human-confirmed ground truth
  - scores confidence, drafts a concrete rule
        │
        ▼
NEW: EngineeringRuleProposal table (PENDING / APPROVED / REJECTED)
        │
        ▼
Developer review UI (new tab next to Brain Inbox)
        │
        ├─ approve ──▶ NEW: LearnedTaxonomyOverlay (DB-backed rules, loaded
        │               alongside the static .data.ts files at resolution time)
        └─ reject ───▶ archived, never resurfaces for the same evidence set
```

The overlay is the key design choice: approved rules are **not** written into `workPackageTaxonomy.data.ts` / `engineeringVocabulary.data.ts` directly. Those stay hand-authored, git-tracked, code-reviewed. Learned rules live in their own table, loaded at runtime and merged in after the static rules, same pattern already used for `EngineeringKnowledgeEntry`. This means: no redeploy needed to take effect, full audit trail of what the system taught itself vs what a person wrote, and a one-row delete to instantly revert a bad promotion.

## 4. Data model additions

### 4.1 `EngineeringRuleProposal`

```prisma
model EngineeringRuleProposal {
  id                String   @id @default(cuid())
  companyId         String   @map("company_id")
  /// OBJECT | WORK | DISCIPLINE_OBJECT_FALLBACK | DELIVERABLE_TYPE
  kind              String   @db.VarChar(32)
  /// The id this proposal would create/extend, e.g. "combined_mep" or an
  /// existing id it adds a new pattern to, e.g. "mechanical"
  targetId          String   @map("target_id") @db.VarChar(64)
  targetLabel       String   @map("target_label") @db.VarChar(128)
  /// The regex/keyword pattern being proposed
  proposedPattern   String   @map("proposed_pattern") @db.Text
  /// Human-readable evidence summary shown in the review UI
  rationale         String   @db.Text
  supportingFingerprints Json @default("[]") @map("supporting_fingerprints")
  occurrences       Int      @map("occurrences")
  projectCount      Int      @map("project_count")
  confirmedDecisionCount Int @map("confirmed_decision_count")
  consistency       Float    // 0..1, share of occurrences resolving the same way
  confidenceScore   Float    @map("confidence_score")
  status            String   @default("PENDING") @db.VarChar(16) // PENDING | APPROVED | REJECTED
  reviewedBy        String?  @map("reviewed_by") @db.VarChar(255)
  reviewNotes       String?  @map("review_notes") @db.Text
  createdAt         DateTime @default(now()) @map("created_at")
  reviewedAt        DateTime? @map("reviewed_at")

  company Company @relation(fields: [companyId], references: [id], onDelete: Cascade)

  @@unique([companyId, kind, targetId, proposedPattern])
  @@index([companyId, status])
  @@map("engineering_rule_proposals")
}
```

### 4.2 `EngineeringLearnedRule`

Created automatically when a proposal is approved; this is what actually gets merged into resolution.

```prisma
model EngineeringLearnedRule {
  id              String   @id @default(cuid())
  companyId       String   @map("company_id")
  kind            String   @db.VarChar(32)
  targetId        String   @map("target_id") @db.VarChar(64)
  targetLabel     String   @map("target_label") @db.VarChar(128)
  pattern         String   @db.Text
  sourceProposalId String  @map("source_proposal_id")
  active          Boolean  @default(true)
  createdAt       DateTime @default(now()) @map("created_at")

  company Company @relation(fields: [companyId], references: [id], onDelete: Cascade)

  @@index([companyId, kind, active])
  @@map("engineering_learned_rules")
}
```

Kept as a separate table from proposals (rather than just flipping status) so resolution-time loading is a trivial `where: { active: true }` query, and disabling a learned rule later doesn't lose the original proposal's audit trail.

## 5. Proposal generation logic

Runs as part of `computeEngineeringBrainDiagnostics`, immediately after the existing `candidateLearning` computation (`engineeringBrainDiagnostics.service.ts` step 5). New step 5b:

1. **Candidate grouping by similarity, not just exact subject match.** Today `candidateLearning` groups by `conceptSubject()` — near-exact string normalization. That's too strict to catch "Combined MEP Services" and "MEP Coordination" as the same underlying gap. Use the existing (currently unused for this purpose) LLM reasoning layer in a batch/offline mode: given a cluster of unresolved concepts sharing a discipline or fragnet, ask it to group them by whether they represent the same real-world engineering concept. This is a good use for the LLM specifically because fuzzy semantic grouping is what it's good at and exact regex is bad at — it is not asked to invent the rule, only to say "these N unresolved names are the same underlying thing."

2. **Cross-reference confirmed ground truth.** For each similarity cluster, check whether any member's fingerprint already has an `EngineeringKnowledgeEntry` with `status IN (DEVELOPER_APPROVED, DEVELOPER_MODIFIED)`. A cluster with zero confirmed decisions never generates a proposal — no proposal is drafted purely from the raw engine's own uncertainty; at least one human must have already vouched for at least one member of the cluster. This is the safeguard against the system bootstrapping confidence entirely from its own unverified guesses.

3. **Score the cluster.**
   - `occurrences` — total raw deliverable rows in the cluster (existing count)
   - `projectCount` — distinct projects (existing count)
   - `confirmedDecisionCount` — how many distinct fingerprints in the cluster have a developer decision
   - `consistency` — share of the cluster's *confirmed* members that agree on the same discipline/object/work resolution (if developers disagreed with each other across the cluster, consistency drops and the proposal is suppressed regardless of volume)
   - `confidenceScore` — a simple weighted combination, e.g. `min(1, occurrences/20) * 0.3 + min(1, projectCount/3) * 0.3 + consistency * 0.4`, gated so it's zero unless `confirmedDecisionCount >= 1`

4. **Draft the pattern.** For an OBJECT/WORK kind, derive a candidate regex from the shared vocabulary across the cluster's deliverable names/fragnets (e.g. the literal substring "mep" appearing case-insensitively across every member) — same shape as the existing hand-written rules in `engineeringVocabulary.data.ts`, so it can be reviewed by eye against real examples. This is a pattern-mining step, not free-form LLM generation of a regex — mined patterns are safer to eyeball than LLM-authored regex, and match the existing rule style exactly.

5. **Only surface proposals above a threshold** (suggest starting at `confidenceScore >= 0.5 AND confirmedDecisionCount >= 1 AND projectCount >= 2`, tunable) to keep the queue meaningful rather than noisy.

## 6. Review UI

New card on the Engineering Brain dev dashboard, "Rule Proposals," next to Brain Inbox. Each entry shows: the proposed pattern, target id/label, the rationale text, a sample of the actual deliverable names/fragnets that fed it, the confirmed decisions that back it (linked to their existing review record), and the confidence score. Two buttons: Approve (creates the `EngineeringLearnedRule` row, marks proposal APPROVED) and Reject (marks REJECTED, stores optional notes, and — importantly — the same evidence cluster should not regenerate an identical proposal on the next diagnostics run; check for an existing REJECTED proposal with the same `(kind, targetId, proposedPattern)` before drafting a new one).

## 7. Resolution-time wiring

`resolveEngineeringIdentity()` (in `engineeringIdentity.service.ts`) currently reads only the static `ENGINEERING_OBJECT_RULES` / `WORK_PACKAGE_TAXONOMY` / `DOCUMENT_TYPE_RULES` arrays. Add a company-scoped load of active `EngineeringLearnedRule` rows (same graceful-degradation pattern as `engineeringKnowledgeStore.service.ts` — if the table isn't there yet, behave as if there are zero learned rules) and merge them in as additional entries in the same rule arrays before matching runs. Learned rules should be tagged distinctly in the evidence output (e.g. `source: "LEARNED_RULE"` vs `source: "TAXONOMY"`) so a developer can always see, per-identity, whether a resolution came from a hand-authored rule or something the system proposed and a human approved. This is also what finally lets "Behaviour across imported programmes" and the Maturity dimensions move: once a learned rule is active, previously-unknown deliverables genuinely resolve on their own, so `unknownEngineeringObjects`/`coverage`/`potentialNewEngineeringObjects` all shift for real, measuring an actual improvement in the deterministic engine rather than a memorized decision.

## 8. Where the disabled LLM reasoning layer fits

Two distinct uses, not to be conflated:

- **Per-deliverable reasoning** (already built in `engineeringReasoning.service.ts`, gated behind `AI_ENGINEERING_REASONING_ENABLED`): enable this to get better one-shot resolution on deliverables that don't match any rule yet, learned or hand-authored. Worth wiring the currently-always-empty `aliases` field in `EngineeringReasoningContext` to include a handful of the nearest confirmed `EngineeringKnowledgeEntry` examples (by shared discipline/fragnet) as few-shot context — cheap win, no new infra needed, distinct from the proposal system above.
- **Cluster similarity grouping** (new, described in §5 step 1): a narrower, batch use of the same LLM provider, used only to decide "are these unresolved names the same underlying gap," never to invent the rule itself or to auto-approve anything.

Both are optional accelerants. The proposal pipeline in §5 works with pure string/statistical clustering (exact/near-exact subject matching, same as `candidateLearning` today) if you'd rather not enable the LLM at all yet — it'll just catch fewer, more literal duplicates until the LLM grouping is turned on.

## 9. Rollout plan

1. Migration: add `EngineeringRuleProposal` + `EngineeringLearnedRule` tables (additive only, same degrade-gracefully pattern as the existing knowledge store — nothing breaks if the migration lags behind a deploy).
2. Ship proposal generation (§5) reading from existing `candidateLearning` + `EngineeringKnowledgeEntry`, using plain subject-string clustering first (no LLM dependency to start).
3. Ship the review UI (§6) and resolution-time merge (§7) together — a proposal is useless until approving it visibly changes something.
4. Once stable, add the LLM similarity clustering (§5 step 1) to catch fuzzier duplicates, and separately consider enabling `AI_ENGINEERING_REASONING_ENABLED` with the `aliases` few-shot wiring (§8) as an independent improvement.
5. Instrument: log every proposal's confidence score and whether it was approved/rejected, so the threshold in §5.5 can be tuned against real approve/reject rates instead of guessed once and left alone.

## 10. Open questions to settle before building

- Should a rejected proposal block on `(kind, targetId, proposedPattern)` exactly, or on the underlying evidence cluster (so a slightly different mined pattern from the same rejected cluster doesn't just resurface)?
- Should `confidenceScore` weighting (§5.3) be configurable per company, or fixed?
- Does a learned rule ever get promoted back into the hand-authored `.data.ts` files (e.g. after N months of stability), or does it stay in the DB overlay forever? Leaving it in the overlay forever is simpler and equally effective at resolution time; moving it into source is really only about wanting it visible in code review/git history.
