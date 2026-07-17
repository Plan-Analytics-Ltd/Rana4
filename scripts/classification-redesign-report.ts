/**
 * Classification context report — document-type aware.
 * Run: npx tsx scripts/classification-redesign-report.ts
 */
import { resolveWorkPackageTaxonomy } from "../src/services/intelligence/taxonomy/workPackageTaxonomy.service.ts";
import { extractDocumentType } from "../src/services/intelligence/taxonomy/documentType.extraction.ts";
import { normaliseDeliverableNameForTaxonomy } from "../src/services/intelligence/taxonomy/taxonomyMatching.utils.ts";

const examples: Array<{
  name: string;
  fragnet?: string | null;
  parentWbs?: string | null;
  disciplineTag?: string | null;
}> = [
  { name: "New Technical Note - Mechanical", fragnet: "Mechanical Design" },
  { name: "Updated Design Drawing - Electrical", fragnet: "Electrical Design" },
  { name: "General Arrangement Drawing - Structural", fragnet: "Structural Design" },
  { name: "Equipment Specification - Mechanical", fragnet: "Mechanical Design" },
  { name: "Fire Strategy Report", fragnet: "Fire Engineering" },
  { name: "Ground Investigation Report" },
  { name: "Fire Engineering Report", fragnet: "Fire Engineering" },
  { name: "Report - Fire Engineering" },
  { name: "Drawing - Mechanical", fragnet: "Mechanical Design" },
  { name: "Issued for Construction Design Drawing - Mechanical", fragnet: "Mechanical Design" },
  { name: "Rev A Technical Note - Mechanical", fragnet: "Mechanical Design" },
  { name: "Drainage" },
  { name: "GI" },
  { name: "Fire Safety Engineering", fragnet: "Fire Engineering" },
  { name: "Link Structure Survey" },
  { name: "Design Schematics - Mechanical" },
  { name: "BWIC" },
  { name: "BWIC", fragnet: "Structural Design" },
  { name: "Model/Drawing Development", fragnet: "Mechanical Design" },
  { name: "Model Drawing Development", fragnet: "Mechanical Design" },
  { name: "Model / Drawing Development", fragnet: "Mechanical Design" },
  { name: "Steelwork" },
  { name: "Equipment Specifications" },
  { name: "BREEAM" },
  { name: "Net Zero Carbon" },
];

const totals = { classified: 0, other: 0, unclassified: 0 };
const sourceCounts = new Map<string, number>();
const improved: string[] = [];

console.log("Classification context report (document-type aware)\n");
console.log("name | docType | result | discipline | category | work package | source");
console.log("-".repeat(130));

for (const ex of examples) {
  const norm = normaliseDeliverableNameForTaxonomy(ex.name);
  const doc = extractDocumentType(norm);
  const r = resolveWorkPackageTaxonomy({
    deliverableName: ex.name,
    fragnetName: ex.fragnet ?? null,
    parentWbs: ex.parentWbs ?? null,
    disciplineTag: ex.disciplineTag ?? null,
  });

  let result = "unclassified";
  if (r.matched && r.isUnknownWorkPackage) {
    result = "other_wp";
    totals.other += 1;
  } else if (r.matched) {
    result = "classified";
    totals.classified += 1;
  } else {
    totals.unclassified += 1;
  }
  sourceCounts.set(r.disciplineSource, (sourceCounts.get(r.disciplineSource) ?? 0) + 1);

  const usedDocType =
    r.matched &&
    !r.isUnknownWorkPackage &&
    doc &&
    (r.diagnostics.workPackageReason.includes("document-type") ||
      r.diagnostics.workPackageReason.includes("document type"));
  if (usedDocType || (doc && r.matched && !r.isUnknownWorkPackage && ["Report", "Drawing", "Specification", "Technical Note"].some((x) => ex.name.includes(x)))) {
    if (doc && r.matched && !r.isUnknownWorkPackage) {
      improved.push(
        `${ex.name} → ${doc.label} + ${r.disciplineLabel} → ${r.workPackageLabel}`
      );
    }
  }

  console.log(
    [
      ex.name,
      doc ? `${doc.label}${doc.residualSubject ? ` (subj: ${doc.residualSubject})` : ""}` : "—",
      result,
      r.disciplineLabel ?? "—",
      r.categoryLabel ?? "—",
      r.workPackageLabel ?? "—",
      r.disciplineSource,
    ].join(" | ")
  );
}

console.log("\nTotals");
console.log(`  Classified (known WP):     ${totals.classified}`);
console.log(`  Other <Discipline> Work:   ${totals.other}`);
console.log(`  Fully unclassified:        ${totals.unclassified}`);
console.log("\nWinning context source counts");
for (const [k, v] of [...sourceCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${v}`);
}

console.log("\nImproved via document-type separation");
for (const line of [...new Set(improved)]) {
  console.log(`  ${line}`);
}

console.log("\nStill needing taxonomy growth / context");
for (const ex of examples) {
  const r = resolveWorkPackageTaxonomy({
    deliverableName: ex.name,
    fragnetName: ex.fragnet ?? null,
    parentWbs: ex.parentWbs ?? null,
  });
  if (!r.matched || r.isUnknownWorkPackage) {
    const norm = normaliseDeliverableNameForTaxonomy(ex.name);
    const doc = extractDocumentType(norm);
    console.log(
      `  [${r.matched ? "other" : "unclassified"}] ${ex.name}` +
        (doc ? ` [doc=${doc.label}]` : "") +
        ` → ${r.disciplineLabel ?? "—"} / ${r.categoryLabel ?? "—"}`
    );
  }
}
