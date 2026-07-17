# Duration Statistics: Improving Name-Similarity Accuracy

Status: DRAFT — not yet implemented. Confirmed still not implemented as of 2026-07-17: live `/app/deliverables` page shows "Meetings — Work package" matched against "RDDB015 - Review Information, Go/No-Go meeting & Instruction to Proceed" flagged `low similarity (0%)`, despite both names sharing the same root word ("Meetings" / "meeting"). This is the exact plural/singular stemming gap described below, now confirmed with real production data — use this pair as a required regression test (see section 4).
Builds on: `duration-stats-name-consistency-flag-spec.md` (shipped, verified). That shipped a warning flag using naive Jaccard token overlap. This spec improves the underlying similarity function itself — still no filtering, still no data-volume dependency, just a more accurate score.

## 1. What's actually wrong with the current function

The shipped `nameSimilarity()` compares raw normalized word tokens. Confirmed by its own regression test: "Reinforcement Detailing" vs "Reinforcement Detail Drawings" scores 0.25 (below the 0.3 threshold) purely because "detail" and "detailing" are treated as two unrelated tokens. That's a real weakness in the function, not a data problem — no amount of extra project history fixes it, because the words genuinely are almost the same and the function just doesn't know that.

Two distinct causes, two distinct fixes:

1. **Same word, different form** ("detail" / "detailing", "drawing" / "drawings") — fixable with lightweight stemming, zero domain knowledge required.
2. **Different word, same engineering meaning** ("rebar" / "reinforcement") — stemming can't fix this; it needs domain vocabulary. The good news: that vocabulary already exists, hand-curated and trusted, in `ENGINEERING_OBJECT_RULES` (`src/services/intelligence/taxonomy/engineeringVocabulary.data.ts`) — e.g. the `reinforcement` object rule already lists `reinforcement`, `rebar`, and `rc frame` as synonyms via its `patterns` array. Reuse it rather than building a new synonym list from scratch.

## 2. What to build

### 2.1 Lightweight stemming

Add a small suffix-stripping step before tokenizing — not a full Porter stemmer, just enough to collapse the common cases actually seen in deliverable names: trailing `ing`, `s`, `es`, `ed` on tokens of reasonable length (e.g. don't strip from 3-letter tokens where it'd mangle the word). Keep it conservative and testable; the goal is "detailing" → "detail", "drawings" → "drawing", not linguistic completeness.

### 2.2 Vocabulary-aware canonicalization

Before tokenizing a name for similarity, run each token (post-stemming) through the existing `ENGINEERING_OBJECT_RULES` patterns from `engineeringVocabulary.data.ts` (already exported) — if a token matches one of a rule's `patterns`, replace it with that rule's `id` (e.g. both "reinforcement" and "rebar" become the canonical token `reinforcement`) before building the comparison set. This is read-only reuse of an existing, already-trusted list — no new vocabulary maintenance burden, and it means any future addition to that taxonomy file (which will happen anyway as the Brain taxonomy grows) automatically improves this similarity function too, for free.

### 2.3 Where this lives

Keep it in `deliverableDurationStatisticsPresentation.service.ts`, same as the current function — this is a refinement of `nameSimilarity`/`normaliseForSimilarity`, not a new subsystem. Importing `ENGINEERING_OBJECT_RULES` (a plain data array, no side effects) from the taxonomy module is fine and doesn't create the kind of cross-system coupling we've been avoiding with `matching/`/`benchmark/` — this is the Brain's own vocabulary, and this whole duration-stats pipeline already depends on the Brain's identity resolution anyway.

## 3. What this does and doesn't change

Does: make the existing confidence flag more accurate — fewer legitimate taxonomy-equivalent wordings ("Rebar Detailing", "Reinforcement Detail Drawings") should incorrectly trip `lowNameConsistency`.

Does not: fix the GET-Milestones/Secondary-Steelwork pooling itself. Those names ("Enabling Works" vs "BWIC" vs "Architectural Setting Out") are genuinely, semantically different — no stemming or synonym table makes them similar, and they shouldn't score as similar. The flag should keep firing on those, correctly. That's the confirmation this improvement worked as intended, not a sign it failed.

Does not: turn the flag into a filter. Still additive-metadata-only, per the previous spec's scope. Whether to eventually use an improved similarity score to prefer higher-similarity samples over lower ones within a matched tier (a softer middle ground between "flag" and "hard exclude") is a real option worth considering **after** this improved function proves itself against real data — not bundled into this pass.

## 4. Testing (regression-critical)

Re-run and extend the existing wording-variant test in `tests/integration/deliverable-duration-statistics-presentation.test.mjs`:
- "Reinforcement Detailing" vs "Rebar Detailing" vs "Reinforcement Detail Drawings" — all three should now score meaningfully higher than the current 0.333/0.25, ideally above `LOW_NAME_CONSISTENCY_THRESHOLD` (0.3), and report the actual before/after scores in the test output so the improvement is visible, not just asserted.
- The GET-Milestones pooling test and the Secondary-Steelwork-style test — confirm these **still** score low / still trigger `lowNameConsistency`. If the vocabulary canonicalization accidentally makes these score higher too (e.g. because multiple GET Milestones items all mention "GET" as a shared token), that's a regression in the other direction and must be caught here, not discovered later.
- Add a couple more known Brain vocabulary synonym pairs as test cases beyond reinforcement/rebar, pulled from `ENGINEERING_OBJECT_RULES` itself (e.g. anything with multiple `patterns` in one rule) to confirm the canonicalization generalizes rather than being special-cased to just the one example we happened to test.
- **Required: "Meetings — Work package" vs "RDDB015 - Review Information, Go/No-Go meeting & Instruction to Proceed"** — real production pair, currently scores 0% (no shared tokens: "meetings" ≠ "meeting" without stemming). After the fix, this should score meaningfully higher via plain stemming alone (no vocabulary table needed — "meeting"/"meetings" is the same word, just a suffix). Report the actual before/after score.
