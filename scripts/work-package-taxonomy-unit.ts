/**
 * Unit checks for context-aware work package taxonomy (presentation layer).
 * Run: npx tsx scripts/work-package-taxonomy-unit.ts
 */
import assert from "node:assert/strict";
import {
  isStageMetadataOnly,
  normaliseDeliverableNameForTaxonomy,
  resolveWorkPackageTaxonomy,
} from "../src/services/intelligence/taxonomy/workPackageTaxonomy.service.ts";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("Work package taxonomy unit tests\n");

test("normalises Model/Drawing variants to one canonical string (no duplication)", () => {
  const variants = [
    "Model/Drawing Development",
    "Model Drawing Development",
    "Model / Drawing Development",
  ].map(normaliseDeliverableNameForTaxonomy);
  assert.equal(variants[0], "model drawing development");
  assert.equal(variants[0], variants[1]);
  assert.equal(variants[1], variants[2]);
  assert.equal(variants[0]!.includes("model model"), false);
});

test("normalises Net Zero Carbon without duplicating carbon", () => {
  assert.equal(normaliseDeliverableNameForTaxonomy("Net Zero Carbon"), "net zero carbon");
  assert.equal(normaliseDeliverableNameForTaxonomy("Net Zero"), "net zero carbon");
});

test("strips discipline suffix after dash normalisation", () => {
  assert.equal(normaliseDeliverableNameForTaxonomy("Design Schematics - Mechanical"), "design schematics");
  assert.equal(normaliseDeliverableNameForTaxonomy("Design Schematics - MEP"), "design schematics");
});

test("groups Technical Note variants under Mechanical > Technical Notes", () => {
  const newNote = resolveWorkPackageTaxonomy({
    deliverableName: "New Technical Note - Mechanical",
    fragnetName: "Mechanical Design",
  });
  const updatedNote = resolveWorkPackageTaxonomy({
    deliverableName: "Updated Technical Note - Mechanical",
    fragnetName: "Mechanical Design",
  });
  assert.equal(newNote.matched, true);
  assert.equal(updatedNote.matched, true);
  assert.equal(newNote.taxonomyKey, updatedNote.taxonomyKey);
  assert.equal(newNote.workPackageLabel, "Technical Notes");
  assert.equal(newNote.disciplineLabel, "Mechanical");
  assert.equal(newNote.disciplineSource, "fragnet");
});

test("fragnet wins over deliverable name for discipline", () => {
  const r = resolveWorkPackageTaxonomy({
    deliverableName: "Reinforcement Detailing",
    fragnetName: "Structural Design",
  });
  assert.equal(r.disciplineSource, "fragnet");
  assert.equal(r.disciplineLabel, "Structural");
  assert.equal(r.workPackageLabel, "Reinforcement Detailing");
});

test("soft failure keeps other-work category under discipline (Fire Safety Engineering)", () => {
  const r = resolveWorkPackageTaxonomy({
    deliverableName: "Fire Safety Engineering",
    fragnetName: "Fire Engineering",
  });
  assert.equal(r.matched, true);
  assert.equal(r.isUnknownWorkPackage, true);
  assert.equal(r.disciplineLabel, "Fire Engineering");
  assert.equal(r.categoryLabel, "Other Fire Engineering Work");
  assert.ok(r.taxonomyKey?.includes("unknown_work_package"));
  assert.equal(r.diagnostics.softFailure, true);
});

test("soft failure for Design Schematics under Mechanical from name context", () => {
  const r = resolveWorkPackageTaxonomy({
    deliverableName: "Design Schematics - Mechanical",
  });
  assert.equal(r.matched, true);
  assert.equal(r.isUnknownWorkPackage, true);
  assert.equal(r.disciplineLabel, "Mechanical");
  assert.equal(r.categoryLabel, "Other Mechanical Work");
});

test("soft failure for Link Structure Survey under Structural", () => {
  const r = resolveWorkPackageTaxonomy({
    deliverableName: "Link Structure Survey",
  });
  assert.equal(r.matched, true);
  assert.equal(r.isUnknownWorkPackage, true);
  assert.equal(r.disciplineLabel, "Structural");
  assert.equal(r.categoryLabel, "Other Structural Work");
  assert.equal(r.workPackageLabel, "Link Structure Survey");
});

test("does not promote parentWbs into fragnet source", () => {
  const r = resolveWorkPackageTaxonomy({
    deliverableName: "BWIC",
    parentWbs: "Structural Design",
  });
  assert.equal(r.matched, true);
  assert.equal(r.disciplineLabel, "Structural");
  assert.equal(r.disciplineSource, "wbs");
});

test("real fragnet beats deliverable keyword for discipline", () => {
  const r = resolveWorkPackageTaxonomy({
    deliverableName: "Technical Notes",
    fragnetName: "Mechanical Design",
  });
  assert.equal(r.disciplineSource, "fragnet");
  assert.equal(r.disciplineLabel, "Mechanical");
  assert.equal(r.workPackageLabel, "Technical Notes");
});

test("Equipment Specifications inferred via unique Architecture work-package pattern", () => {
  const r = resolveWorkPackageTaxonomy({
    deliverableName: "Equipment Specifications",
  });
  assert.equal(r.matched, true);
  assert.equal(r.disciplineLabel, "Architecture");
  assert.equal(r.workPackageLabel, "Specifications");
  assert.equal(r.disciplineSource, "work_package_inference");
});

test("Model/Drawing Development with Mechanical fragnet classifies to BIM work package", () => {
  const a = resolveWorkPackageTaxonomy({
    deliverableName: "Model/Drawing Development",
    fragnetName: "Mechanical Design",
  });
  const b = resolveWorkPackageTaxonomy({
    deliverableName: "Model / Drawing Development",
    fragnetName: "Mechanical Design",
  });
  assert.equal(a.matched, true);
  assert.equal(a.isUnknownWorkPackage, false);
  assert.equal(a.taxonomyKey, b.taxonomyKey);
  assert.equal(a.workPackageLabel, "Model / Drawing Development");
});

test("BWIC without context remains fully unclassified", () => {
  const r = resolveWorkPackageTaxonomy({ deliverableName: "BWIC" });
  assert.equal(r.matched, false);
  assert.equal(r.disciplineId, null);
});

test("BWIC with Structural fragnet is soft failure under Structural", () => {
  const r = resolveWorkPackageTaxonomy({
    deliverableName: "BWIC",
    fragnetName: "Structural Design",
  });
  assert.equal(r.matched, true);
  assert.equal(r.isUnknownWorkPackage, true);
  assert.equal(r.disciplineLabel, "Structural");
});

test("preserves original deliverable name in resolution", () => {
  const r = resolveWorkPackageTaxonomy({
    deliverableName: "New Technical Note - Mechanical",
    fragnetName: "Mechanical Design",
  });
  assert.equal(r.originalDeliverableName, "New Technical Note - Mechanical");
});

test("does not treat project stage labels as work packages", () => {
  assert.equal(isStageMetadataOnly("detailed design"), true);
  const r = resolveWorkPackageTaxonomy({
    deliverableName: "Detailed Design",
    fragnetName: "Structural Design",
  });
  assert.equal(r.matched, false);
});

test("groups meetings under Project Management", () => {
  const r = resolveWorkPackageTaxonomy({
    deliverableName: "Design Coordination Meeting",
  });
  assert.equal(r.disciplineLabel, "Project Management");
  assert.equal(r.workPackageLabel, "Meetings");
});

test("groups sustainability reports under Sustainability > BREEAM", () => {
  const r = resolveWorkPackageTaxonomy({
    deliverableName: "Report - Sustainability - BREEAM",
  });
  assert.equal(r.disciplineLabel, "Sustainability");
  assert.equal(r.workPackageLabel, "BREEAM");
});

test("diagnostics are always present", () => {
  const r = resolveWorkPackageTaxonomy({
    deliverableName: "Technical Notes",
    fragnetName: "Mechanical Design",
  });
  assert.ok(r.diagnostics.disciplineReason.length > 0);
  assert.ok(r.diagnostics.normalisedName.length > 0);
});

test("extracts document type and classifies Fire Engineering + Report", () => {
  const r = resolveWorkPackageTaxonomy({
    deliverableName: "Fire Engineering Report",
    fragnetName: "Fire Engineering",
  });
  assert.equal(r.matched, true);
  assert.equal(r.isUnknownWorkPackage, false);
  assert.equal(r.workPackageLabel, "Fire Reports");
  assert.equal(r.diagnostics.documentTypeLabel, "Report");
});

test("Mechanical + Drawing classifies to Design Drawings", () => {
  const r = resolveWorkPackageTaxonomy({
    deliverableName: "Drawing",
    fragnetName: "Mechanical Design",
  });
  assert.equal(r.disciplineLabel, "Mechanical");
  assert.equal(r.workPackageLabel, "Design Drawings");
});

test("Structural + General Arrangement Drawing → General Arrangements", () => {
  const r = resolveWorkPackageTaxonomy({
    deliverableName: "General Arrangement Drawing - Structural",
    fragnetName: "Structural Design",
  });
  assert.equal(r.workPackageLabel, "General Arrangements");
  assert.equal(r.diagnostics.documentTypeId === "general_arrangement" || r.diagnostics.documentTypeId === "drawing", true);
});

test("strips Issued for Construction / Rev prefixes before matching", () => {
  const a = resolveWorkPackageTaxonomy({
    deliverableName: "Issued for Construction Design Drawing - Mechanical",
    fragnetName: "Mechanical Design",
  });
  const b = resolveWorkPackageTaxonomy({
    deliverableName: "Rev B Technical Note - Mechanical",
    fragnetName: "Mechanical Design",
  });
  assert.equal(a.workPackageLabel, "Design Drawings");
  assert.equal(b.workPackageLabel, "Technical Notes");
});

test("Ground Investigation Report uses document type → GI Reports", () => {
  const r = resolveWorkPackageTaxonomy({
    deliverableName: "Ground Investigation Report",
  });
  assert.equal(r.disciplineLabel, "Ground Investigation");
  assert.equal(r.workPackageLabel, "GI Reports");
  assert.equal(r.diagnostics.documentTypeLabel, "Report");
});

console.log("\nAll work package taxonomy unit tests passed.");
