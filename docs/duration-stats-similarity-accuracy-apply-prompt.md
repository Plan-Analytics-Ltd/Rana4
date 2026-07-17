# Cursor prompt: implement name-similarity accuracy fix

Paste this to Cursor.

---

Implement `docs/duration-stats-similarity-accuracy-spec.md` in full. This improves the accuracy of the existing `nameSimilarity()`/`normaliseForSimilarity()` functions in `src/services/deliverableDurationStatisticsPresentation.service.ts` (currently: lowercase, strip punctuation, split into tokens ≥3 chars, plain Jaccard overlap — no stemming, no synonym awareness).

Confirmed live bug this fixes: on `/app/deliverables`, "Meetings — Work package" is matched against "RDDB015 - Review Information, Go/No-Go meeting & Instruction to Proceed" and flagged `low similarity (0%)`, even though both names share the same root word — "meetings" and "meeting" are treated as unrelated tokens because there's no stemming. This is a real, narrow, fixable bug, not a data problem.

Two independent fixes, both scoped in the spec:

1. **Lightweight stemming** — strip common suffixes (`ing`, `s`, `es`, `ed`) from tokens before comparing, conservatively (don't mangle short tokens). This alone fixes the Meetings case: "meetings" → "meeting" matches "meeting" exactly.
2. **Vocabulary-aware canonicalization** — reuse the existing `ENGINEERING_OBJECT_RULES` array from `src/services/intelligence/taxonomy/engineeringVocabulary.data.ts` (already exported, already trusted) to collapse known synonyms (e.g. "reinforcement"/"rebar"/"rc frame" → canonical `reinforcement`) before comparing. Read-only reuse, no new vocabulary list to maintain.

Critical constraints (both explicitly called out in the spec, don't skip):

- This only makes the existing confidence flag (`lowNameConsistency`, threshold `LOW_NAME_CONSISTENCY_THRESHOLD = 0.3`) more accurate. It stays a flag, not a filter — this pass does not change matching/pooling logic, only the similarity score used for the warning.
- Genuinely different deliverables (Enabling Works vs BWIC vs Architectural Setting Out — the GET-Milestones pooling case) must **still** score low after this change. If canonicalization makes them score higher because they share incidental tokens (e.g. "GET"), that's a regression — catch it in tests, don't discover it later.

Testing (all required, extend `tests/integration/deliverable-duration-statistics-presentation.test.mjs`):

- "Reinforcement Detailing" vs "Rebar Detailing" vs "Reinforcement Detail Drawings" — currently 0.333 and 0.25 (both below the 0.3 threshold); should score meaningfully higher after the fix. Report actual before/after numbers.
- **"Meetings — Work package" vs "RDDB015 - Review Information, Go/No-Go meeting & Instruction to Proceed"** — currently 0%; should score meaningfully higher after stemming alone. Report actual before/after numbers.
- The existing GET-Milestones pooling test and Secondary-Steelwork test — confirm these still score low / still trigger the flag. This is the regression guard described above.
- Add 1-2 more synonym pairs pulled directly from `ENGINEERING_OBJECT_RULES` entries that have multiple `patterns`, to confirm canonicalization generalizes rather than being special-cased to reinforcement/rebar alone.

Report real before/after scores for all of the above, not just pass/fail — same standard as every other change in this project.
