# Duration Statistics: Name-Consistency Confidence Flag

Status: DRAFT — not yet implemented
Builds on: the knowledge-store wiring in `duration-stats-knowledge-store-wiring-spec.md` (shipped, verified working)

## 1. The problem (observed in production data, not theoretical)

Confirmed live on `/app/deliverables` after the knowledge-store wiring shipped: several genuinely different deliverables that share the same coarse `discipline|engineeringObject|engineeringWork` identity are now pooling into the same historical sample set, because `compareEngineeringIdentities` only compares those three ids — it has no concept of "these are different named things."

Two concrete confirmed cases:
- Enabling Works, Architectural Setting Out, BWIC, Equipment Specifications, GI, and Drainage (the "GET Milestones" cluster) all resolved to `project_management / project_management / milestone` during Brain review — correct for classification purposes, since no more precise vocabulary id exists for a generic gateway checkpoint. But it means all six now draw their Min/Avg/Max from whichever single historical sample matched first ("Readiness Milestone", 1 day) — treating six different real-world events as interchangeable.
- Ceilings, Elevations, Partitions, and Ambulance Bay Canopy (the "Secondary Steelwork" cluster) all resolved to `structural / steelwork / detailing` — again correct taxonomically, but it means a small ceiling detail and the ambulance bay canopy pool into the same 2-day figure.

## 2. Why the obvious fix (a hard name-similarity filter) is risky right now

Requiring matched candidates to also pass a minimum name-similarity threshold would directly address the pooling above, but it cuts against the exact thing the Engineering Brain taxonomy exists to do: recognize that "Reinforcement Detailing" and "Rebar Detailing" are the same real concept despite dissimilar wording (this is one of the Brain's own built-in consistency probes — see `DEFAULT_CONSISTENCY_PROBES` in `engineeringBrainDiagnostics.service.ts`). A naive token-overlap filter would likely score that pair low and could silently exclude a legitimate match, with only 2 projects of real history to notice the regression against.

Decision: don't hard-filter. Compute and surface a name-consistency signal instead, so a human sees when a number is blending different-sounding work and can judge it, rather than either silently pooling everything (today) or silently dropping real matches (the risky alternative).

## 3. What to build

### 3.1 Local, self-contained similarity function

Add a small, pure, synchronous helper directly in `deliverableDurationStatisticsPresentation.service.ts` — do **not** import from `src/services/intelligence/matching/` or `benchmark/` (those stay a separate system, per existing scope boundary). Something like:

```ts
function normaliseForSimilarity(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((token) => token.length >= 3)
  );
}

function nameSimilarity(a: string, b: string): number {
  const setA = normaliseForSimilarity(a);
  const setB = normaliseForSimilarity(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  const intersection = [...setA].filter((token) => setB.has(token)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}
```

(Jaccard similarity over normalized word tokens — same spirit as the tokenization already used in `matching/deliverableFingerprint.service.ts`, reimplemented locally rather than imported, to keep the two systems decoupled.)

### 3.2 Compute and attach consistency data

In `computeStrictOriginalDurationItems`, once `selectedSamples` is chosen (the tier-selected contributing samples for a target):

- Compute `nameSimilarity(target.name, sample.matchedDeliverableName)` for every sample.
- Add `nameSimilarity: number` to each entry in `contributingProjects` (so the existing "Previous Projects" dialog, which already lists each matched deliverable name, can show a per-row similarity indicator).
- Add a top-level `nameConsistency: number` to `HistoricalDurationItem` — the **minimum** similarity across all contributing samples (worst case, not average — one wildly different contributor should be enough to caution the whole number, not get diluted by better ones).
- Add `lowNameConsistency: boolean`, true when `nameConsistency < LOW_NAME_CONSISTENCY_THRESHOLD`. Export that threshold as a named constant (start at `0.3`, comment that it's a rough starting point to be tuned once more project history exists — do not treat it as validated).
- When there's only one contributing sample, `nameConsistency` should still be computed (target vs that one sample) rather than defaulting to 1 — a single dissimilar-name match is exactly the case worth flagging.

### 3.3 Frontend

In `frontend/app/app/deliverables/page.tsx` (the Min/Avg/Max cells) and `frontend/components/deliverables/historical-planning-dialog.tsx` (the "Previous Projects" modal):
- Show a small caution indicator (icon + tooltip, e.g. "These figures blend differently-named work — review before relying on them") on the Min/Avg/Max cells when `lowNameConsistency` is true. Don't hide or alter the numbers — just flag them.
- In the modal, show the per-project `nameSimilarity` next to each contributing deliverable (e.g., a muted "low similarity" tag) so a user opening it — which they already do — can see which specific contributor is dragging the number down.

## 4. Testing

Add to `tests/integration/deliverable-duration-statistics-presentation.test.mjs`:
- A case reproducing the GET-Milestones-style scenario (same identity, clearly different deliverable names across samples) — confirm `lowNameConsistency: true` and a low `nameConsistency` score, while the actual Min/Avg/Max values are unchanged from current behavior (nothing gets filtered).
- A case with uniformly-named or near-identical matches — confirm `lowNameConsistency: false`.
- **Regression guard, non-negotiable:** a case with legitimate wording variants ("Reinforcement Detailing" vs "Rebar Detailing" vs "Reinforcement Detail Drawings" — reuse the wording set from `DEFAULT_CONSISTENCY_PROBES`) — confirm these still match (unchanged from today) and ideally confirm the similarity score isn't so low that a future hard-filter attempt would be tempted to exclude them. If this test shows the naive token similarity actually scores these poorly, flag it in your summary rather than silently proceeding — that's useful information about whether this similarity function needs a smarter approach (e.g. stemming, or synonym awareness) before anyone considers a hard filter later.

## 5. Explicitly out of scope for this pass

No hard filtering, no exclusion of any current match, no change to `compareEngineeringIdentities` or the Brain taxonomy itself, no changes to `benchmark.service.ts` / `matching/`. This is a transparency layer only.
