# Stress tests & design notes

Summary of stress tests and how the API behaves.

---

## 1. Multi-standard isolation

**Scenario:** Standard A and Standard B each have fragnets, activities, assurance notes, deliverables.

**Can data from Standard A reference Standard B?**

- **Activity (Fragnet A) → Assurance note (Standard B):** **No.** The API validates that when you link an assurance note to an activity, the note’s standard matches the fragnet’s standard. Otherwise you get **400** “Assurance note must belong to the same standard as the fragnet”.
- **Deliverable (Standard A) → Assurance note (Standard B):** **No.** The API validates that when you link an assurance note to a deliverable, the note’s standard matches the deliverable’s standard. Otherwise you get **400** “Assurance note must belong to the same standard”.

**Implementation:** `activities.controller` and `deliverables.controller` check `note.standardId === fragnet.standardId` (activities) or `note.standardId === standardId` (deliverables) when `assuranceNoteId` is provided (create and update).

---

## 2. Activity deletion impact (cascade)

**Scenario:** A1 → A2 → A3 (relationships A1 FS A2, A2 FS A3). Delete A2.

**Expected:** Relationships A1→A2 and A2→A3 are removed (DB cascade). Export does not crash and does not reference the deleted activity.

**Implementation:** Prisma schema has `onDelete: Cascade` on `Relationship` → `Activity`. Deleting an activity removes all relationships where it is predecessor or successor. Export only reads the current fragnet (activities + relationships); no orphaned references.

**Test:** `npm run test:api` includes a step that creates A1→A2→A3, deletes A2, then calls export and asserts success.

---

## 3. Relationship redundancy (duplicates)

**Scenario:** Create A1 FS A2 twice (same fragnet, same predecessor/successor).

**Behaviour:** The API rejects the duplicate. **400** “Duplicate relationship: same predecessor and successor already exists for this fragnet”.

**Implementation:** Before creating a relationship, the controller checks for an existing row with the same `fragnetId`, `predecessorActivityId`, `successorActivityId`. If found, it returns 400.

**Test:** `npm run test:api` sends the same relationship twice and expects 400 on the second request.

---

## 4. Export stability (deterministic order)

**Scenario:** Activities created in random order; some may share the same `created_at` (e.g. under load).

**Behaviour:** Export ID mapping (A1000, A1001, …) is deterministic. Activities are sorted by `created_at` ascending, then by `id` ascending when timestamps tie. So ordering is stable even when timestamps are identical.

**Implementation:** `export.service.ts` uses `sortActivitiesForExport()` which compares `createdAt` then `a.id.localeCompare(b.id)`.

---

## 5. Duration extremes

**Scenario:** `bestDuration = 1`, `likelyDuration = 10_000` (or other extremes).

**Behaviour:** Export still works. There is no scheduling math or overflow logic; export only writes the values into CSV. No risk from large durations.

---

## 6. Large fragnet

**Scenario:** 100+ activities, 200+ relationships.

**Behaviour:** Export is linear in activities + relationships (no recursion, no graph traversal). It should scale without issue.

---

## 7. Circular logic

**Scenario:** A1 → A2 → A3 → A1 (cycle).

**Behaviour:** The API does **not** detect cycles. It is not a scheduling engine; it does not evaluate logic. It only stores and exports data. Cycle detection is left to the consumer (e.g. P6). This is an intentional scope boundary.

---

## 8. Partial data

**Scenario:** Activity with no relationships and no assurance note.

**Behaviour:** Export is still valid. TASK CSV has the activity; TASKPRED CSV simply has no row for it. Optional `assuranceNoteId` is not required for export.

---

## 9. Deliverables isolation

Deliverables are independent of fragnets: they do not auto-generate activities, do not link to fragnet logic, and are not included in the fragnet export (which is activity/relationship only). No behavioural coupling; architecturally correct.
