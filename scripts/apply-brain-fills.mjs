#!/usr/bin/env node
/**
 * Applies the reviewed, verified fills from brain-fills-final-v2.csv to the
 * real EngineeringKnowledgeEntry table, using the application's own
 * recordEngineeringReviewDecision() function (not raw prisma writes) so the
 * versionHistory, version stamps, and upsert-by-fingerprint semantics are
 * identical to a real developer review action taken through the app.
 *
 * - For the 51 existing entries: fetches each by (companyId, concept) to get
 *   its real, current fingerprint, then calls recordEngineeringReviewDecision
 *   with action=MODIFY and the corrected field values.
 * - For the 13 previously-auto-approved (never persisted) concepts: re-runs
 *   the exact same diagnostics pipeline the review UI uses to get each
 *   concept's real fingerprint fresh, then calls recordEngineeringReviewDecision
 *   with action=APPROVE to persist it for the first time.
 * - VI-027 ("Inclusion of Paeds Link") is intentionally excluded — it stays
 *   REJECTED with all fields null, untouched.
 *
 * Every write is logged. If ANY expected existing entry can't be found by
 * concept text, or a fingerprint can't be resolved, this script fails loudly
 * for that row rather than guessing.
 */
import { prisma } from "../dist/utils/prisma.js";
import { recordEngineeringReviewDecision } from "../dist/services/intelligence/diagnostics/engineeringKnowledgeStore.service.js";
import {
  loadObservedDeliverablesForCompany,
  computeEngineeringBrainDiagnostics,
} from "../dist/services/intelligence/diagnostics/engineeringBrainDiagnostics.service.js";
import { loadEngineeringKnowledge, isEngineeringKnowledgeStoreAvailable } from "../dist/services/intelligence/diagnostics/engineeringKnowledgeStore.service.js";

const REVIEWED_BY = "aelsaman@plananalytics.co.uk";
const BATCH_NOTE_SUFFIX = "[Batch 3 - precision pass] Reviewed and corrected/completed all six identity fields against real evidence and the canonical taxonomy vocabulary.";

// --- The 51 existing entries to update (concept must match exactly) ---
const EXISTING_UPDATES = [
  { concept: "Additional Engineering Management Works", discipline: "project_management", engineeringObject: "project_management", engineeringWork: "coordination", deliverableType: "assessment", lifecycleStage: "stage_3", aliases: ["EW-001 Engineering Management Works"], notes: "deliverableType/aliases filled. " + BATCH_NOTE_SUFFIX },
  { concept: "Additional Ground Investigation", discipline: "ground_investigation", engineeringObject: "ground_investigation", engineeringWork: "inspection", deliverableType: "report", lifecycleStage: "stage_3", aliases: ["Ground Investigation Report", "GIR"], notes: "engineeringObject filled using a new 'ground_investigation' taxonomy object id added for this purpose. " + BATCH_NOTE_SUFFIX },
  { concept: "Additional Structural Works", discipline: "structural", engineeringObject: "link_bridge", engineeringWork: "coordination", deliverableType: "assessment", lifecycleStage: "stage_3", aliases: ["EW-001 Structural Change Coordination"], notes: "engineeringObject restored to link_bridge (largest single cluster, 3 of 10 activities) and deliverableType filled to assessment, superseding a prior null-clearing decision per explicit instruction to leave no field empty. " + BATCH_NOTE_SUFFIX },
  { concept: "Ambulance Bay Canopy", discipline: "structural", engineeringObject: "steelwork", engineeringWork: "detailing", deliverableType: "drawing", lifecycleStage: "stage_3", aliases: ["Secondary Steelwork - Ambulance Bay Canopy Drawings"], notes: "Alias only. " + BATCH_NOTE_SUFFIX },
  { concept: "Architectural Setting Out", discipline: "architecture", engineeringObject: "slabs", engineeringWork: "detailing", deliverableType: "drawing", lifecycleStage: "stage_3", aliases: ["Setting Out of Upstands & Slab Edges"], notes: "discipline corrected project_management->architecture (a real, existing taxonomy discipline id); engineeringObject set to slabs. " + BATCH_NOTE_SUFFIX },
  { concept: "CE-015 GL6 Foundation Alteration Feasibility — Work package", discipline: "structural", engineeringObject: "foundations", engineeringWork: "design", deliverableType: "assessment", lifecycleStage: "stage_3", aliases: ["CE-015", "GL6 Foundation Feasibility"], notes: "deliverableType filled to assessment (feasibility study). " + BATCH_NOTE_SUFFIX },
  { concept: "Design (Developed Design Report - MEP)", discipline: "mechanical", engineeringObject: "mechanical_systems", engineeringWork: "design", deliverableType: "report", lifecycleStage: "stage_3", aliases: ["developed design report", "mep report", "riba stage report", "design report", "stage report", "building services report"], notes: "lifecycleStage corrected developed_design->stage_3 (developed_design is not a real taxonomy id). " + BATCH_NOTE_SUFFIX },
  { concept: "Detailed Design (core)", discipline: "structural", engineeringObject: "core", engineeringWork: "design", deliverableType: "drawing", lifecycleStage: "stage_3", aliases: ["Detailed Design - Core"], notes: "deliverableType filled to drawing (sibling-consistency with Detailed Design (steelwork)). " + BATCH_NOTE_SUFFIX },
  { concept: "Detailed Design (drainage)", discipline: "civil", engineeringObject: "drainage", engineeringWork: "design", deliverableType: "drawing", lifecycleStage: "stage_3", aliases: ["Detailed Design - Drainage"], notes: "deliverableType filled to drawing (sibling-consistency). " + BATCH_NOTE_SUFFIX },
  { concept: "Detailed Design (foundations)", discipline: "structural", engineeringObject: "foundations", engineeringWork: "design", deliverableType: "drawing", lifecycleStage: "stage_3", aliases: ["Detailed Design - Foundations"], notes: "deliverableType filled to drawing (sibling-consistency). " + BATCH_NOTE_SUFFIX },
  { concept: "Detailed Design (link bridge)", discipline: "structural", engineeringObject: "link_bridge", engineeringWork: "design", deliverableType: "drawing", lifecycleStage: "stage_3", aliases: ["Detailed Design - Link Bridge"], notes: "deliverableType filled to drawing (sibling-consistency). " + BATCH_NOTE_SUFFIX },
  { concept: "Detailed Design (slabs, Level 9)", discipline: "structural", engineeringObject: "slabs", engineeringWork: "design", deliverableType: "drawing", lifecycleStage: "stage_3", aliases: ["Slab Design", "Slab Analysis", "Detailed Slab Design", "Concrete Slab Design", "Floor Slab Design"], notes: "deliverableType filled to drawing (sibling-consistency). " + BATCH_NOTE_SUFFIX },
  { concept: "Detailed Design (walls/slabs, Level 7)", discipline: "structural", engineeringObject: "slabs", engineeringWork: "design", deliverableType: "drawing", lifecycleStage: "stage_3", aliases: ["Level 7 Detailed Design"], notes: "deliverableType filled to drawing (sibling-consistency). " + BATCH_NOTE_SUFFIX },
  { concept: "Developed Design Drawing - Electrical", discipline: "electrical", engineeringObject: "electrical_systems", engineeringWork: "design", deliverableType: "design_drawing", lifecycleStage: "stage_3", aliases: ["Stage 3 Electrical Developed Design Drawing"], notes: "lifecycleStage filled to stage_3 (Developed Design X family consistency). " + BATCH_NOTE_SUFFIX },
  { concept: "Developed Design Drawing - MEP", discipline: "mechanical", engineeringObject: "plant_room", engineeringWork: "design", deliverableType: "design_drawing", lifecycleStage: "stage_3", aliases: ["Stage 3 MEP Developed Design Drawing"], notes: "lifecycleStage filled to stage_3. " + BATCH_NOTE_SUFFIX },
  { concept: "Developed Design Schedule - Electrical", discipline: "electrical", engineeringObject: "electrical_systems", engineeringWork: "design", deliverableType: "schedule", lifecycleStage: "stage_3", aliases: ["Stage 3 Electrical Developed Design Schedule"], notes: "lifecycleStage filled to stage_3. " + BATCH_NOTE_SUFFIX },
  { concept: "Developed Design Schedule - Mechanical", discipline: "mechanical", engineeringObject: "mechanical_systems", engineeringWork: "design", deliverableType: "schedule", lifecycleStage: "stage_3", aliases: ["Stage 3 Mechanical Developed Design Schedule"], notes: "lifecycleStage filled to stage_3. " + BATCH_NOTE_SUFFIX },
  { concept: "Developed Design Schematics - Electrical", discipline: "electrical", engineeringObject: "electrical_systems", engineeringWork: "design", deliverableType: "drawing", lifecycleStage: "stage_3", aliases: ["Electrical Design Schematics"], notes: "lifecycleStage filled to stage_3. " + BATCH_NOTE_SUFFIX },
  { concept: "Drainage", discipline: "public_health", engineeringObject: "drainage", engineeringWork: "coordination", deliverableType: "milestone", lifecycleStage: "stage_3", aliases: ["GET Drainage Milestone"], notes: "Alias only. " + BATCH_NOTE_SUFFIX },
  { concept: "Enabling Works", discipline: "project_management", engineeringObject: "project_management", engineeringWork: "milestone", deliverableType: "milestone", lifecycleStage: "stage_3", aliases: ["EW Information Receipt"], notes: "Alias only. " + BATCH_NOTE_SUFFIX },
  { concept: "Equipment Specifications", discipline: "project_management", engineeringObject: "project_management", engineeringWork: "design", deliverableType: "specification", lifecycleStage: "stage_3", aliases: ["Imaging Equipment Specification"], notes: "Alias only. " + BATCH_NOTE_SUFFIX },
  { concept: "External Finishes Works — Work package", discipline: "architecture", engineeringObject: "walls", engineeringWork: "detailing", deliverableType: "design_drawing", lifecycleStage: "stage_3", aliases: ["External Envelope Finishes Works"], notes: "discipline corrected null->architecture (a real, existing taxonomy discipline id, contrary to a prior reviewer's note); engineeringObject set to walls. " + BATCH_NOTE_SUFFIX },
  { concept: "Model Development (Level 7)", discipline: "structural", engineeringObject: "core", engineeringWork: "general_arrangement", deliverableType: "drawing", lifecycleStage: "stage_3", aliases: ["Model Development", "Drawing Development", "Model/Drawing Development", "General Arrangement", "General Arrangement Drawings", "GA Drawings", "GA Development"], notes: "engineeringObject filled to core as the single representative value for a WBS that spans core/walls/columns. " + BATCH_NOTE_SUFFIX },
  { concept: "Model/Drawing Development (Structural Design)", discipline: "structural", engineeringObject: "core", engineeringWork: "design", deliverableType: "drawing", lifecycleStage: "stage_3", aliases: ["Structural Model Development"], notes: "engineeringObject filled to core (same WBS-rollup reasoning as Model Development (Level 7)). " + BATCH_NOTE_SUFFIX },
  { concept: "Model/Drawing Development (drainage)", discipline: "public_health", engineeringObject: "drainage", engineeringWork: "design", deliverableType: "design_drawing", lifecycleStage: "stage_3", aliases: ["Drainage Model Development"], notes: "Alias only. " + BATCH_NOTE_SUFFIX },
  { concept: "New Design Drawing - Public Health", discipline: "public_health", engineeringObject: "drainage", engineeringWork: "detailing", deliverableType: "design_drawing", lifecycleStage: "stage_3", aliases: ["Developed Design Drawing - Public Health"], notes: "lifecycleStage filled to stage_3 by analogy to the Developed Design Drawing family. " + BATCH_NOTE_SUFFIX },
  { concept: "New Design Report - Acoustics", discipline: "acoustics", engineeringObject: "acoustics", engineeringWork: "design", deliverableType: "report", lifecycleStage: "stage_3", aliases: ["RIBA Stage Acoustic Strategy Report"], notes: "lifecycleStage filled to stage_3 (dataset default; own evidence names 'RIBA Stage' without a number). " + BATCH_NOTE_SUFFIX },
  { concept: "New Design Report - Fire Safety Engineering", discipline: "fire_engineering", engineeringObject: "fire_safety", engineeringWork: "design", deliverableType: "report", lifecycleStage: "stage_3", aliases: ["RIBA Stage Fire Strategy Report"], notes: "lifecycleStage filled to stage_3 (same reasoning as the Acoustics sibling). " + BATCH_NOTE_SUFFIX },
  { concept: "New Technical Note - Acoustics", discipline: "acoustics", engineeringObject: "acoustics", engineeringWork: "analysis", deliverableType: "technical_note", lifecycleStage: "stage_3", aliases: ["Acoustics Technical Note"], notes: "lifecycleStage filled to stage_3 (dataset default); alias added. " + BATCH_NOTE_SUFFIX },
  { concept: "Partitions", discipline: "structural", engineeringObject: "steelwork", engineeringWork: "detailing", deliverableType: "drawing", lifecycleStage: "stage_3", aliases: ["Secondary Steelwork - Partitions Drawings"], notes: "Alias only. " + BATCH_NOTE_SUFFIX },
  { concept: "Report - Sustainability - BREEAM", discipline: "sustainability", engineeringObject: "sustainability_assessment", engineeringWork: "calculation", deliverableType: "report", lifecycleStage: "stage_3", aliases: ["BREEAM Stage 3 Summary Report"], notes: "engineeringObject filled using a new 'sustainability_assessment' taxonomy object id; lifecycleStage filled to stage_3. " + BATCH_NOTE_SUFFIX },
  { concept: "Report - Sustainability - Environment / Sustainability", discipline: "sustainability", engineeringObject: "sustainability_assessment", engineeringWork: "modelling", deliverableType: "report", lifecycleStage: "stage_3", aliases: ["TM-54 Report"], notes: "Same taxonomy fix as the BREEAM entry. " + BATCH_NOTE_SUFFIX },
  { concept: "Report - Sustainability - Net Zero Carbon", discipline: "sustainability", engineeringObject: "sustainability_assessment", engineeringWork: "calculation", deliverableType: "report", lifecycleStage: "stage_3", aliases: ["NZC Report"], notes: "Same taxonomy fix as the BREEAM entry. " + BATCH_NOTE_SUFFIX },
  { concept: "Retired Activities — Work package", discipline: "structural", engineeringObject: "link_bridge", engineeringWork: "design", deliverableType: "general_arrangement", lifecycleStage: "stage_3", aliases: ["Link Structure GA Drawings (Retired)"], notes: "Alias only. " + BATCH_NOTE_SUFFIX },
  { concept: "Structural Design — Work package", discipline: "structural", engineeringObject: "core", engineeringWork: "design", deliverableType: "general_arrangement", lifecycleStage: "stage_3", aliases: ["CP Drawings Issue"], notes: "engineeringObject filled to core and deliverableType to general_arrangement as single representative values for this WBS-level rollup. " + BATCH_NOTE_SUFFIX },
  { concept: "Updated Technical Note - Electrical", discipline: "electrical", engineeringObject: "electrical_systems", engineeringWork: "technical_note", deliverableType: "technical_note", lifecycleStage: "stage_3", aliases: ["Electrical Technical Note"], notes: "lifecycleStage filled to stage_3 (dataset default). " + BATCH_NOTE_SUFFIX },
  { concept: "Updated Technical Note - MEP", discipline: "mechanical", engineeringObject: "mechanical_systems", engineeringWork: "technical_note", deliverableType: "technical_note", lifecycleStage: "stage_3", aliases: ["MEP Technical Note"], notes: "lifecycleStage filled to stage_3. " + BATCH_NOTE_SUFFIX },
  { concept: "Updated Technical Note - Public Health", discipline: "public_health", engineeringObject: "public_health_system", engineeringWork: "technical_note", deliverableType: "technical_note", lifecycleStage: "stage_3", aliases: ["Public Health Technical Note", "PHE Technical Note"], notes: "lifecycleStage filled to stage_3. " + BATCH_NOTE_SUFFIX },
];

// --- Entries that are already fully specified and correct: no write needed ---
const NO_CHANGE_CONCEPTS = [
  "BWIC", "Ceilings", "Contract Award", "Design Schematics (New Design Schematics - Mechanical)",
  "Detailed Design (steelwork)", "Due Diligence", "GI", "MMD/Client Programme Alignment - Prolongation",
  "Model Drawing/Development (foundations)", "VI-019 Desktop Study - Link Bridge Foundations",
  "VI-045 - Generator Compound — Work package", "VI-046 Link Bridge Surveys",
  "VI-061 Confirmation of Link Bridge 'Option 2' as preferred design solution",
];

// --- The 13 previously auto-approved concepts to persist for the first time ---
const NEW_ENTRIES = [
  { concept: "Reinforcement Detailing", discipline: "structural", engineeringObject: "reinforcement", engineeringWork: "detailing", deliverableType: "drawing", lifecycleStage: "stage_3", aliases: ["Produce Reinforcement Detailing", "Rebar Detailing", "Reinforcement Detail Drawings"], notes: "Previously auto-approved only, never persisted. Persisted with deliverableType/aliases filled. " + BATCH_NOTE_SUFFIX },
  { concept: "Core", discipline: "structural", engineeringObject: "core", engineeringWork: "general_arrangement", deliverableType: "general_arrangement", lifecycleStage: "stage_3", aliases: ["Core GA", "Core General Arrangements"], notes: "Previously auto-approved only. " + BATCH_NOTE_SUFFIX },
  { concept: "Column", discipline: "structural", engineeringObject: "columns", engineeringWork: "detailing", deliverableType: "elevation", lifecycleStage: "stage_3", aliases: ["Column Elevations"], notes: "Previously auto-approved only. " + BATCH_NOTE_SUFFIX },
  { concept: "Wall", discipline: "structural", engineeringObject: "walls", engineeringWork: "detailing", deliverableType: "elevation", lifecycleStage: "stage_3", aliases: ["Wall Elevations"], notes: "Previously auto-approved only. " + BATCH_NOTE_SUFFIX },
  { concept: "Link Structural", discipline: "structural", engineeringObject: "link_bridge", engineeringWork: "inspection", deliverableType: "survey", lifecycleStage: "stage_3", aliases: ["Link Structure Survey", "Link Bridge Survey"], notes: "Previously auto-approved with discipline=project_management (fragnet default); corrected to structural for consistency with the persisted sibling 'VI-046 Link Bridge Surveys'. " + BATCH_NOTE_SUFFIX },
  { concept: "Primary Steelwork (plant Screen)", discipline: "structural", engineeringObject: "primary_steelwork", engineeringWork: "detailing", deliverableType: "drawing", lifecycleStage: "stage_3", aliases: ["Plant Screen Steelwork", "Primary Steelwork Detailing"], notes: "Previously auto-approved only; deliverableType filled. " + BATCH_NOTE_SUFFIX },
  { concept: "Elevations", discipline: "structural", engineeringObject: "steelwork", engineeringWork: "detailing", deliverableType: "elevation", lifecycleStage: "stage_3", aliases: ["Secondary Steelwork Elevations"], notes: "Previously auto-approved only. " + BATCH_NOTE_SUFFIX },
  { concept: "Additional Drainage Works", discipline: "public_health", engineeringObject: "drainage", engineeringWork: "design", deliverableType: "report", lifecycleStage: "stage_3", aliases: ["Additional Drainage Design Works"], notes: "Previously auto-approved only; deliverableType filled to report as the best available default. " + BATCH_NOTE_SUFFIX },
  { concept: "Meetings", discipline: "project_management", engineeringObject: "project_management", engineeringWork: "meeting", deliverableType: "meeting", lifecycleStage: "stage_3", aliases: ["Design Team Meetings", "Coordination Meetings"], notes: "Previously auto-approved only. " + BATCH_NOTE_SUFFIX },
  { concept: "Milestones", discipline: "project_management", engineeringObject: "project_management", engineeringWork: "milestone", deliverableType: "milestone", lifecycleStage: "stage_3", aliases: ["Programme Milestones", "Key Milestones"], notes: "Previously auto-approved with engineeringObject=link_bridge (false precision from one strong activity match); corrected to project_management, matching every other generic PM/milestone concept in this dataset. " + BATCH_NOTE_SUFFIX },
  { concept: "Vi 052 Link Bridge Option 1 (early Structural )", discipline: "structural", engineeringObject: "link_bridge", engineeringWork: "analysis", deliverableType: "analysis", lifecycleStage: "stage_3", aliases: ["VI-052", "Link Bridge Option 1 Early Structural Analysis"], notes: "Previously auto-approved only. " + BATCH_NOTE_SUFFIX },
  { concept: "Fire Safety Engineering", discipline: "fire_engineering", engineeringObject: "fire_safety", engineeringWork: "technical_note", deliverableType: "technical_note", lifecycleStage: "stage_3", aliases: ["Fire Safety Technical Note", "FSE Technical Note"], notes: "Previously auto-approved only; lifecycleStage filled to stage_3. " + BATCH_NOTE_SUFFIX },
  { concept: "3d", discipline: "mechanical", engineeringObject: "plant_room", engineeringWork: "modelling", deliverableType: "model", lifecycleStage: "stage_3", aliases: ["3D Model - MEP", "MEP Coordination Model"], notes: "Previously auto-approved only; lifecycleStage filled to stage_3, directly evidenced by its own related activity name. " + BATCH_NOTE_SUFFIX },
];

async function main() {
  const company = await prisma.company.findFirst({ where: { name: "PlanAnalytics Dev" }, select: { id: true, name: true } });
  if (!company) throw new Error("Company 'PlanAnalytics Dev' not found");
  console.log(`Company: ${company.name} (${company.id})`);

  let updated = 0;
  let skippedNoChange = 0;
  let created = 0;
  const failures = [];

  // --- 1. Update the 37 entries that need real field changes ---
  for (const item of EXISTING_UPDATES) {
    const existing = await prisma.engineeringKnowledgeEntry.findFirst({
      where: { companyId: company.id, concept: item.concept },
      select: { id: true, fingerprint: true, concept: true },
    });
    if (!existing) {
      failures.push(`NOT FOUND (existing update): "${item.concept}"`);
      continue;
    }
    const result = await recordEngineeringReviewDecision({
      companyId: company.id,
      fingerprint: existing.fingerprint,
      action: "MODIFY",
      concept: item.concept,
      identity: {
        discipline: item.discipline,
        engineeringObject: item.engineeringObject,
        engineeringWork: item.engineeringWork,
        deliverableType: item.deliverableType,
        lifecycleStage: item.lifecycleStage,
      },
      aliases: item.aliases,
      notes: item.notes,
      reviewedBy: REVIEWED_BY,
    });
    if (!result) {
      failures.push(`WRITE FAILED (existing update): "${item.concept}"`);
      continue;
    }
    updated += 1;
    console.log(`UPDATED: ${item.concept}`);
  }

  // --- 2. Confirm the "no change needed" entries still exist untouched ---
  for (const concept of NO_CHANGE_CONCEPTS) {
    const existing = await prisma.engineeringKnowledgeEntry.findFirst({
      where: { companyId: company.id, concept },
      select: { id: true },
    });
    if (!existing) {
      failures.push(`NOT FOUND (expected no-change entry): "${concept}"`);
      continue;
    }
    skippedNoChange += 1;
  }

  // --- 3. Persist the 13 previously auto-approved concepts, fingerprints resolved fresh ---
  const observed = await loadObservedDeliverablesForCompany({ companyId: company.id });
  const decisions = await loadEngineeringKnowledge(company.id);
  const report = await computeEngineeringBrainDiagnostics(
    observed,
    [],
    decisions,
    isEngineeringKnowledgeStoreAvailable(),
    {}
  );
  const autoApprovedByConcept = new Map(report.collections.autoApproved.map((e) => [e.concept, e]));

  for (const item of NEW_ENTRIES) {
    const live = autoApprovedByConcept.get(item.concept);
    if (!live) {
      failures.push(`NOT FOUND (expected auto-approved concept, may have shifted since the dump): "${item.concept}"`);
      continue;
    }
    const result = await recordEngineeringReviewDecision({
      companyId: company.id,
      fingerprint: live.fingerprint,
      action: "APPROVE",
      concept: item.concept,
      identity: {
        discipline: item.discipline,
        engineeringObject: item.engineeringObject,
        engineeringWork: item.engineeringWork,
        deliverableType: item.deliverableType,
        lifecycleStage: item.lifecycleStage,
      },
      aliases: item.aliases,
      notes: item.notes,
      reviewedBy: REVIEWED_BY,
      observed: { projectCount: live.projectCount },
    });
    if (!result) {
      failures.push(`WRITE FAILED (new entry): "${item.concept}"`);
      continue;
    }
    created += 1;
    console.log(`CREATED: ${item.concept}`);
  }

  console.log(`\n=== Summary ===`);
  console.log(`Updated: ${updated}/${EXISTING_UPDATES.length}`);
  console.log(`Confirmed no-change: ${skippedNoChange}/${NO_CHANGE_CONCEPTS.length}`);
  console.log(`Newly persisted: ${created}/${NEW_ENTRIES.length}`);
  console.log(`VI-027 (REJECTED) intentionally left untouched.`);
  if (failures.length > 0) {
    console.log(`\n=== FAILURES (${failures.length}) ===`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
