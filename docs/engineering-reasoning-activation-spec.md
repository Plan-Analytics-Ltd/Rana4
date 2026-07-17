# Activating Engineering Reasoning (LLM) as Shared Identity Resolution

Status: DRAFT — not yet implemented
Confirmed: `OPENAI_API_KEY` is live, `AI_EXPLANATION_ENABLED=true`, model `gpt-5.4`, provider `openai` (`.env`). `AI_ENGINEERING_REASONING_ENABLED` is unset (defaults false) — the engineering-specific reasoning layer has never actually run.

## 1. What this is actually fixing

`engineeringReasoning.service.ts` already exists, already has a documented purpose ("the intelligence layer that replaces extraction"), already gracefully falls back to rule-based resolution when disabled/unconfigured/erroring, and already has a 5-minute cache. It has never been switched on, and neither `engineeringBrainDiagnostics.service.ts` nor `deliverableDurationStatisticsPresentation.service.ts` call it — both call the plain regex-based `resolveEngineeringIdentity()` directly. That's the actual disconnect behind the GET-Milestones/Secondary-Steelwork pooling problem: regex resolution has no way to tell "confirm drainage receipt" from "confirm BWIC receipt" apart, so both collapse to the same generic `project_management / milestone` identity. Real reasoning over each deliverable's own activities could plausibly tell them apart — fixing the pooling at the source, not just flagging it.

## 2. The real risk, stated up front

Both current call sites resolve identity **synchronously**, in loops: `engineeringBrainDiagnostics.service.ts` resolves one identity per observed deliverable (potentially thousands across all imported snapshots); `deliverableDurationStatisticsPresentation.service.ts` resolves one identity per target **and** one per historical candidate, nested inside a loop over every other project's every deliverable. `reasonEngineeringIdentity()` is async and calls a live LLM. Naively awaiting it inside those existing loops would mean hundreds to thousands of live API calls per single page load or diagnostics run — real latency (could blow past request timeouts entirely), real dollar cost that scales with data volume, and real risk of hitting OpenAI rate limits. This is the actual reason this has to be staged, not just switched on.

## 3. Staged rollout — do not skip stages

### Phase 1 (this pass): bound the blast radius to where it's already cheap and already needed

**Brain diagnostics** (`engineeringBrainDiagnostics.service.ts`): only reason about deliverables the deterministic engine has **already flagged NEEDS_REVIEW/CONTRADICTORY** — i.e., only what's already landing in the Brain Inbox today (currently a small, bounded set, not the full ~91 raw observed rows). This matches the trust model's own existing philosophy ("work autonomously, ask for help only when genuinely uncertain") — now the thing being asked is a real reasoning engine, before it ever reaches a human. Concretely: after the existing rule-based grouping into `fingerprintGroups` and trust assessment, for groups where `state !== "TRUSTED"`, call `reasonEngineeringIdentity()` once per **group** (not per raw occurrence — reuse one representative record per group, same as the code already does for building `BrainInboxItem`), re-run `assessEngineeringTrust` on the reasoned result, and only fall through to the Brain Inbox if it's still uncertain after reasoning.

**Duration statistics** (`deliverableDurationStatisticsPresentation.service.ts`): only reason about the **target** deliverable (bounded by the existing 200-item request cap, typically far fewer per page in practice) — not the historical candidates being compared against. Candidates keep resolving via the existing fast rule-based path, unchanged, for this phase. This won't fully solve the pooling on its own (a smarter target identity compared against unchanged coarse candidate identities may still land in a broad `ORGANISATION_WIDE` tier), but it's a safe, bounded, observable first increment — not a full, uncontrolled rollout.

### Phase 2 (later, only after Phase 1 is observed safe in real use): extend reasoning to historical candidates too, with pre-computation

If Phase 1 proves out (acceptable cost, acceptable latency, real accuracy improvement), extend reasoning to historical candidates — but pre-compute and cache their reasoned identities at import time (when a `ProgrammeSnapshot` is captured), not live at query time, so a duration-stats query never triggers a live LLM call for data that's been sitting in the database for months. This is explicitly out of scope for this pass — do not build it now.

## 4. Safeguards (required for Phase 1, not optional)

- **Concurrency limit**: cap simultaneous in-flight reasoning calls (e.g. a small fixed pool, not unbounded `Promise.all` over every uncertain group/target).
- **Hard time budget**: if reasoning calls haven't returned within a defined budget for a given request, fall back to the rule-based result for whatever hasn't completed rather than blocking the whole response indefinitely. `reasonEngineeringIdentity` already has its own 60s-per-call timeout inside the OpenAI provider — that's not sufficient on its own if 50 of these run in sequence.
- **Telemetry**: reuse the already-existing `recordEngineeringReasoningEvent`/`getRecentEngineeringReasoningEvents` (already wired, already exported) so every reasoning call's cost/latency/outcome is observable — don't build new logging, this already exists and is just unused so far.
- **Kill switch stays real**: `AI_ENGINEERING_REASONING_ENABLED=false` must instantly and completely revert both call sites to today's pure rule-based behavior, byte for byte. Test this explicitly, not just assume the existing fallback covers it.

## 5. Context-building detail (easy to get subtly wrong)

`reasonEngineeringIdentity()` takes an `EngineeringReasoningContext`, which is a richer shape than `EngineeringIdentityInput`. Building it from what each caller already has:
- `deliverableName`, `fragnetName`, `parentWbs`, `wbsPath`, `disciplineTag`, `activityCodeDiscipline`, `classificationTags`, `stage` → direct passthrough from what's already fetched.
- `activityNames` ← `relatedActivityNames` (already collected in both callers).
- `neighbours` ← `neighbourNames`/sibling deliverables, all as `relation: "SIBLING"` (neither caller currently distinguishes predecessor/successor — don't invent that distinction, pass what's actually known).
- `taxonomy` (`disciplineId`, `disciplineLabel`, `workPackageId`, `workPackageLabel`, `matched`, `isUnknownWorkPackage`) ← this comes from `resolveWorkPackageTaxonomy()` (`workPackageTaxonomy.service.ts`), a **different function** than `resolveEngineeringIdentity()`. Both need to be called — the rule-based `EngineeringIdentity` result is still computed first (it's the fallback and the baseline reasoning compares against), and `resolveWorkPackageTaxonomy()` additionally for the `taxonomy` field specifically. Do not skip this or approximate it from the `EngineeringIdentity` fields — they're not the same shape.
- `aliases` ← for the Brain diagnostics caller, real aliases exist (from any prior developer decision, if wiring that in later); for duration-stats, pass `[]` for now, same as `gatherLiveEngineeringReasoningContext` already does elsewhere in the codebase.

## 6. Testing (before/after comparison, not just unit tests)

Build a comparison harness that runs the real Brain diagnostics computation twice against the same current data — once with `forceRuleBased: true` (today's behavior) and once with reasoning enabled — and diffs the results. Specifically confirm:
- The GET-Milestones cluster (Enabling Works, Architectural Setting Out, BWIC, Equipment Specifications, GI, Drainage) — check whether reasoning resolves any of these to more specific, differentiated identities than the shared `project_management/project_management/milestone` today. Report what actually happens, don't assume it improves — it might not, and that's useful information too.
- The existing `DEFAULT_CONSISTENCY_PROBES` (Fire Technical Note, Reinforcement Detailing, Public Health Technical Note wording variants) still resolve consistently — these already pass under the rule-based system; confirm reasoning doesn't regress them.
- Real cost/latency numbers from an actual run against real data, not estimates — report total reasoning calls made, total latency, and (if obtainable from the OpenAI response usage data already parsed by `openaiLlmProvider.ts`) approximate token cost for one full diagnostics run.
- Confirm `AI_ENGINEERING_REASONING_ENABLED=false` reproduces today's output exactly (regression guard on the kill switch itself).

## 7. Explicitly out of scope for this pass

Phase 2 (candidate-side reasoning, pre-computation at import time), any change to `benchmark.service.ts`/`matching/`, any change to how developer review decisions are stored, any UI changes beyond what's needed to observe the diagnostics comparison. This pass is: turn the reasoning layer on for the two places it's cheapest and most needed, safely, observably, reversibly.
