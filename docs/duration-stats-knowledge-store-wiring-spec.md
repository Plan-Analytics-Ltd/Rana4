# Wire Developer-Reviewed Identities into Duration Statistics

Status: DRAFT — not yet implemented
Confirmed by direct code read of `src/services/deliverableDurationStatisticsPresentation.service.ts` (2026-07-16), corroborating a Cursor-run audit of the same file.

## 1. The actual problem (confirmed, not speculative)

The Min/Avg/Max columns on `/app/deliverables` are computed by `computeStrictOriginalDurationItems()` in `deliverableDurationStatisticsPresentation.service.ts`. For every deliverable (the "target") it resolves an `EngineeringIdentity` via the private `engineeringIdentity()` helper in that file (which just calls `resolveEngineeringIdentity()` + `enforceEngineeringIdentityValidation()`), and does the same for every historical deliverable across every other project (the "candidates"). A candidate only counts as a match if `compareEngineeringIdentities(target, candidate).equivalent` is true, which requires discipline, engineeringObject, and engineeringWork to all be non-null and identical on both sides — no partial credit.

This is 100% independent of `EngineeringKnowledgeEntry` — the table where developer review decisions (approve/modify/reject) are persisted. `deliverableDurationStatisticsPresentation.service.ts` never imports or queries it. So every one of the 48 decisions reviewed through the Engineering Brain has zero effect here: identity is re-resolved from raw deterministic rules every time, exactly as if no review had ever happened.

Concretely: many of those 48 decisions exist precisely because raw resolution was incomplete (that's why they landed in the Brain Inbox in the first place). Wherever a decision filled in the missing discipline/object/work, this table still sees the original incomplete identity and still fails to match — for both that deliverable acting as a target, and for it acting as a historical candidate for other projects' estimates.

## 2. The fix

Add a lookup step: before comparing target/candidate identities, check whether a developer decision exists for that identity's fingerprint, and if so use the corrected fields instead of the raw ones.

### 2.1 Fingerprint must match exactly how it was stored

Fingerprints are `engineeringIdentityFingerprint(subjectKey, identity)` (`src/services/intelligence/taxonomy/engineeringTrust.service.ts`, already exported) — a hash of `subjectKey + "::" + discipline|object|work` using the **raw, pre-correction** identity signature. `subjectKey` comes from the private `conceptSubject(name)` helper in `engineeringBrainDiagnostics.service.ts` (currently NOT exported).

This must be reused byte-for-byte, not reimplemented. If the duration-stats service computes its own slightly different subject-key normalization, it will produce different hashes and silently never match any of the 48 stored decisions. **Export `conceptSubject` from `engineeringBrainDiagnostics.service.ts` and import it directly** — do not rewrite it.

### 2.2 Override logic

For both the target and every candidate identity computed in `computeStrictOriginalDurationItems`:

1. Compute the raw identity via the existing `resolveEngineeringIdentity()` path (unchanged).
2. Compute `subjectKey = conceptSubject(name).key` and `fingerprint = engineeringIdentityFingerprint(subjectKey, rawIdentity)`.
3. Look up `fingerprint` in a `Map<string, StoredEngineeringKnowledge>` loaded once per request via the existing `loadEngineeringKnowledge(companyId)` (`engineeringKnowledgeStore.service.ts`) — same function the Brain diagnostics already use, no new persistence code needed.
4. If no entry: use the raw identity, unchanged (today's behavior, exactly).
5. If entry found with `status` `DEVELOPER_APPROVED` or `DEVELOPER_MODIFIED`: build a corrected `EngineeringIdentity` using the decision's `discipline` / `engineeringObject` / `engineeringWork` / `deliverableType` / `lifecycleStage` fields in place of the raw ones (keep `fragnetContext`/`projectContext`/evidence from the raw resolution — the decision only overrides the five taxonomy fields, matching what `EngineeringKnowledgeIdentity` actually stores). Mark `status: "RESOLVED"` if all three core fields (discipline, object, work) are non-null after the override, same rule the rest of the codebase uses.
6. If entry found with `status: "REJECTED"`: return an identity that can never match anything (all fields null, status not `"RESOLVED"`) — a rejected scope item shouldn't contribute or receive historical duration evidence at all, whether it's the target or a candidate. This mirrors how the Brain itself treats rejections.
7. Must degrade gracefully exactly like every other consumer of `engineeringKnowledgeStore.service.ts`: if `isEngineeringKnowledgeStoreAvailable()` is false (migration not applied), skip the lookup entirely and behave exactly as today. Zero risk to existing behavior if this ships before/without the migration.

### 2.3 Where to apply it

`engineeringIdentity()` (the private helper, line ~165 of the file) is called in three places inside `computeStrictOriginalDurationItems`: once for the target, once per historical snapshot candidate, once per live-project candidate. All three need the override applied — a helper like `resolveIdentityWithReview(input, knowledge)` wrapping the existing `engineeringIdentity()` call is the cleanest way to do this once and use it in all three spots.

`loadEngineeringKnowledge(args.companyId)` should be called once in `getDeliverableDurationStatisticsPresentation` (alongside the existing `deliverables`/`snapshots`/`liveProjects` queries) and threaded down into `computeStrictOriginalDurationItems` as a new parameter, rather than re-fetched per target/candidate.

## 3. What this does and doesn't fix

Does fix: any deliverable whose fingerprint has a `DEVELOPER_APPROVED`/`DEVELOPER_MODIFIED` decision with a complete (non-null) discipline/object/work will now be able to match against other equally-complete deliverables, both as a target and as a historical candidate — pulling real Min/Avg/Max numbers from project history that raw resolution alone couldn't reach.

Doesn't fix: deliverables like `VI-045 - Generator Compound` whose reviewed decision correctly left discipline/object/work null (genuinely multi-discipline scope) will still show empty Min/Avg/Max — correctly so, since forcing a single identity onto genuinely mixed-discipline work would be a false match, not a real one. Empty here is the right answer, not a bug.

Doesn't touch: `benchmark.service.ts` and the fingerprint/similarity pipeline behind it (Ask Rana / intelligence benchmark panels) — confirmed separate system, out of scope for this fix.

## 4. Testing

`tests/integration/deliverable-duration-statistics-presentation.test.mjs` already exists and covers the current behavior. Add cases for:
- A target with an incomplete raw identity but a `DEVELOPER_MODIFIED` decision filling in all three core fields — confirm it now matches a candidate with the same corrected identity.
- A candidate (not the target) with a `DEVELOPER_MODIFIED` decision — confirm it can now contribute a duration sample it couldn't before.
- A fingerprint with a `REJECTED` decision — confirm it's excluded both as target (returns unavailable) and as candidate (never contributes a sample), even though its raw resolution might otherwise look complete.
- Knowledge store unavailable (mock `isEngineeringKnowledgeStoreAvailable()` returning false) — confirm behavior is byte-identical to current pre-change output.
