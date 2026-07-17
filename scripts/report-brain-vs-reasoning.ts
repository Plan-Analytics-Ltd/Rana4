/**
 * Read-only comparison report: Engineering Brain review decisions
 * (EngineeringKnowledgeEntry) vs backfilled reasoned identities
 * (DeliverableSnapshot.reasoned* columns).
 *
 * Matching uses the same fingerprint basis as the duration-stats service:
 * rule-based identity of the snapshot row + conceptSubject(name).key
 * → engineeringIdentityFingerprint. No new matching logic, no writes.
 *
 *   npx tsx scripts/report-brain-vs-reasoning.ts [--companyId <id>]
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";
import { resolveEngineeringIdentity } from "../src/services/intelligence/taxonomy/engineeringIdentity.service.js";
import { enforceEngineeringIdentityValidation } from "../src/services/intelligence/taxonomy/engineeringIdentityValidation.service.js";
import { engineeringIdentityFingerprint } from "../src/services/intelligence/taxonomy/engineeringTrust.service.js";
import { conceptSubject } from "../src/services/intelligence/diagnostics/engineeringBrainDiagnostics.service.js";
import { loadEngineeringKnowledge } from "../src/services/intelligence/diagnostics/engineeringKnowledgeStore.service.js";
import { resolveDefaultCompanyId } from "../src/services/intelligence/taxonomy/engineeringReasoningBackfill.service.js";

const prisma = new PrismaClient();
const DEFAULT_MARKDOWN_PATH = join(process.cwd(), "docs", "brain-vs-reasoning-report.md");

function mdEscape(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

type Classification = "AGREE" | "REASONING_MORE_COMPLETE" | "DISAGREE" | "NO_REASONED_DATA";

const FIELDS = [
  "discipline",
  "engineeringObject",
  "engineeringWork",
  "deliverableType",
  "lifecycleStage",
] as const;
type FieldName = (typeof FIELDS)[number];

/**
 * The pooled generic milestone identity ("project_management / project_management /
 * milestone"). When a decision holds one of these generic values and reasoning has a
 * different specific value, that is "more complete", not a hard disagreement.
 */
const GENERIC_VALUES: Record<FieldName, Set<string>> = {
  discipline: new Set(["project_management"]),
  engineeringObject: new Set(["project_management"]),
  engineeringWork: new Set(["milestone"]),
  deliverableType: new Set(),
  lifecycleStage: new Set(),
};

type ReasonedFields = {
  discipline: string | null;
  engineeringObject: string | null;
  engineeringWork: string | null;
  deliverableType: string | null;
  lifecycleStage: string | null;
};

type SnapshotRowInfo = {
  deliverableSnapshotId: string;
  snapshotId: string;
  projectName: string;
  name: string;
  parentWbs: string | null;
  wbsPath: string | null;
  reasoningSource: string | null;
  reasoned: ReasonedFields;
  relatedActivityNames: string[];
  neighbourNames: string[];
};

function tagsRecord(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function activityCodeDiscipline(
  activities: Array<{ classificationTags: Prisma.JsonValue | null }>
): string | null {
  for (const activity of activities) {
    const tags = tagsRecord(activity.classificationTags);
    if (!tags) continue;
    for (const [key, value] of Object.entries(tags)) {
      if (!key.toLowerCase().includes("discipline")) continue;
      const resolved = String(value ?? "").trim();
      if (resolved) return resolved;
    }
  }
  return null;
}

function identityLabel(fields: ReasonedFields): string {
  return `${fields.discipline ?? "?"}/${fields.engineeringObject ?? "?"}/${fields.engineeringWork ?? "?"}` +
    (fields.deliverableType || fields.lifecycleStage
      ? ` (type=${fields.deliverableType ?? "?"}, stage=${fields.lifecycleStage ?? "?"})`
      : "");
}

function compareField(
  field: FieldName,
  decisionValue: string | null,
  reasonedValue: string | null
): "agree" | "moreComplete" | "disagree" {
  if (reasonedValue == null) return "agree"; // reasoning left it null — no conflict
  if (decisionValue == null) return "moreComplete";
  if (decisionValue === reasonedValue) return "agree";
  if (GENERIC_VALUES[field].has(decisionValue)) return "moreComplete";
  return "disagree";
}

function classify(
  decision: ReasonedFields,
  reasoned: ReasonedFields
): { classification: Exclude<Classification, "NO_REASONED_DATA">; fieldNotes: string[] } {
  let hasDisagree = false;
  let hasMoreComplete = false;
  const fieldNotes: string[] = [];
  for (const field of FIELDS) {
    const verdict = compareField(field, decision[field], reasoned[field]);
    if (verdict === "disagree") {
      hasDisagree = true;
      fieldNotes.push(`${field}: ${decision[field]} vs ${reasoned[field]} (DISAGREE)`);
    } else if (verdict === "moreComplete") {
      hasMoreComplete = true;
      fieldNotes.push(`${field}: ${decision[field] ?? "null"} -> ${reasoned[field]} (more specific)`);
    }
  }
  return {
    classification: hasDisagree ? "DISAGREE" : hasMoreComplete ? "REASONING_MORE_COMPLETE" : "AGREE",
    fieldNotes,
  };
}

async function main(): Promise<void> {
  const companyIdArgIndex = process.argv.indexOf("--companyId");
  let companyId =
    companyIdArgIndex >= 0 ? process.argv[companyIdArgIndex + 1]?.trim() ?? null : null;
  if (!companyId) {
    const resolved = await resolveDefaultCompanyId(prisma);
    companyId = resolved.companyId;
    console.log(`Company: ${resolved.companyName ?? "?"} (${companyId})`);
  } else {
    console.log(`Company: ${companyId}`);
  }

  const decisions = await loadEngineeringKnowledge(companyId);
  console.log(`Stored Brain review decisions: ${decisions.size}`);

  // Load all snapshot rows with the same context the duration-stats candidate path uses.
  const snapshots = await prisma.programmeSnapshot.findMany({
    where: { companyId },
    select: {
      id: true,
      stage: true,
      sector: true,
      projectType: true,
      project: { select: { name: true } },
      deliverableSnapshots: {
        select: {
          id: true,
          deliverableId: true,
          name: true,
          classification: true,
          parentWbs: true,
          wbsPath: true,
          stage: true,
          discipline: true,
          classificationTags: true,
          reasonedDiscipline: true,
          reasonedEngineeringObject: true,
          reasonedEngineeringWork: true,
          reasonedDeliverableType: true,
          reasonedLifecycleStage: true,
          reasoningSource: true,
        },
      },
      activitySnapshots: {
        select: { deliverableId: true, name: true, classificationTags: true },
      },
    },
  });

  // fingerprint -> snapshot rows (computed exactly like duration-stats candidates)
  const rowsByFingerprint = new Map<string, SnapshotRowInfo[]>();
  let totalRows = 0;
  let reasonedRows = 0;

  for (const snapshot of snapshots) {
    const activitiesByDeliverable = new Map<string, typeof snapshot.activitySnapshots>();
    for (const activity of snapshot.activitySnapshots) {
      if (!activity.deliverableId) continue;
      const list = activitiesByDeliverable.get(activity.deliverableId) ?? [];
      list.push(activity);
      activitiesByDeliverable.set(activity.deliverableId, list);
    }
    const siblingsByFragnet = new Map<string, string[]>();
    for (const d of snapshot.deliverableSnapshots) {
      const key = d.parentWbs ?? d.wbsPath ?? "";
      if (!key) continue;
      const list = siblingsByFragnet.get(key) ?? [];
      list.push(d.name);
      siblingsByFragnet.set(key, list);
    }

    for (const d of snapshot.deliverableSnapshots) {
      totalRows += 1;
      if (d.reasoningSource != null) reasonedRows += 1;
      const related = d.deliverableId
        ? activitiesByDeliverable.get(d.deliverableId) ?? []
        : [];
      const relatedActivityNames = related
        .map((a) => a.name?.trim())
        .filter((name): name is string => Boolean(name));

      const raw = enforceEngineeringIdentityValidation(
        resolveEngineeringIdentity({
          deliverableName: d.name,
          parentWbs: d.parentWbs,
          wbsPath: d.wbsPath,
          disciplineTag: d.discipline,
          activityCodeDiscipline: activityCodeDiscipline(related),
          classificationTags: tagsRecord(d.classificationTags),
          classification: d.classification,
          lifecycleStage: d.stage ?? snapshot.stage,
          projectContext: { sector: snapshot.sector, projectType: snapshot.projectType },
          relatedActivityNames,
        })
      );
      const fingerprint = engineeringIdentityFingerprint(conceptSubject(d.name).key, raw);

      const fragnetKey = d.parentWbs ?? d.wbsPath ?? "";
      const neighbourNames = (siblingsByFragnet.get(fragnetKey) ?? [])
        .filter((name) => name !== d.name)
        .slice(0, 8);

      const list = rowsByFingerprint.get(fingerprint) ?? [];
      list.push({
        deliverableSnapshotId: d.id,
        snapshotId: snapshot.id,
        projectName: snapshot.project.name,
        name: d.name,
        parentWbs: d.parentWbs,
        wbsPath: d.wbsPath,
        reasoningSource: d.reasoningSource,
        reasoned: {
          discipline: d.reasonedDiscipline,
          engineeringObject: d.reasonedEngineeringObject,
          engineeringWork: d.reasonedEngineeringWork,
          deliverableType: d.reasonedDeliverableType,
          lifecycleStage: d.reasonedLifecycleStage,
        },
        relatedActivityNames,
        neighbourNames,
      });
      rowsByFingerprint.set(fingerprint, list);
    }
  }

  console.log(`Deliverable snapshot rows: ${totalRows} (${reasonedRows} with reasoned identity)`);

  const counts: Record<Classification, number> = {
    AGREE: 0,
    REASONING_MORE_COMPLETE: 0,
    DISAGREE: 0,
    NO_REASONED_DATA: 0,
  };
  let unmatchedDecisions = 0;

  type ReportRow = {
    concept: string;
    status: string;
    fingerprint: string;
    deliverableName: string;
    projectName: string;
    decisionIdentity: string;
    reasonedIdentity: string;
    reasoningSource: string;
    classification: Classification;
    fieldNotes: string[];
    fragnet: string;
    activities: string[];
    neighbours: string[];
    matchCount: number;
  };
  const reportRows: ReportRow[] = [];

  const sortedDecisions = [...decisions.values()].sort((a, b) =>
    a.concept.localeCompare(b.concept)
  );

  for (const decision of sortedDecisions) {
    const matches = rowsByFingerprint.get(decision.fingerprint) ?? [];
    const reasonedMatches = matches.filter((m) => m.reasoningSource != null);

    if (matches.length === 0) {
      unmatchedDecisions += 1;
      counts.NO_REASONED_DATA += 1;
      reportRows.push({
        concept: decision.concept,
        status: decision.status,
        fingerprint: decision.fingerprint,
        deliverableName: "(no matching snapshot)",
        projectName: "",
        decisionIdentity: identityLabel(decision.identity),
        reasonedIdentity: "(none)",
        reasoningSource: "",
        classification: "NO_REASONED_DATA",
        fieldNotes: [],
        fragnet: "",
        activities: [],
        neighbours: [],
        matchCount: 0,
      });
      continue;
    }

    if (reasonedMatches.length === 0) {
      counts.NO_REASONED_DATA += 1;
      const example = matches[0]!;
      reportRows.push({
        concept: decision.concept,
        status: decision.status,
        fingerprint: decision.fingerprint,
        deliverableName: example.name,
        projectName: example.projectName,
        decisionIdentity: identityLabel(decision.identity),
        reasonedIdentity: "(snapshot matched but reasoningSource null)",
        reasoningSource: "",
        classification: "NO_REASONED_DATA",
        fieldNotes: [],
        fragnet: example.parentWbs ?? example.wbsPath ?? "",
        activities: example.relatedActivityNames,
        neighbours: example.neighbourNames,
        matchCount: matches.length,
      });
      continue;
    }

    const distinct = new Map<string, { row: SnapshotRowInfo; count: number }>();
    for (const row of reasonedMatches) {
      const key = identityLabel(row.reasoned);
      const existing = distinct.get(key);
      if (existing) existing.count += 1;
      else distinct.set(key, { row, count: 1 });
    }

    let worst: Classification = "AGREE";
    const worstNotes: string[] = [];
    let primary: { label: string; row: SnapshotRowInfo; count: number; fieldNotes: string[] } | null =
      null;

    for (const [label, { row, count }] of distinct) {
      const { classification, fieldNotes } = classify(decision.identity, row.reasoned);
      if (!primary) primary = { label, row, count, fieldNotes };
      if (classification === "DISAGREE") {
        worst = "DISAGREE";
        worstNotes.splice(0, worstNotes.length, ...fieldNotes);
        primary = { label, row, count, fieldNotes };
      } else if (classification === "REASONING_MORE_COMPLETE" && worst !== "DISAGREE") {
        worst = "REASONING_MORE_COMPLETE";
        worstNotes.splice(0, worstNotes.length, ...fieldNotes);
        primary = { label, row, count, fieldNotes };
      } else if (worst === "AGREE" && fieldNotes.length > 0) {
        worstNotes.splice(0, worstNotes.length, ...fieldNotes);
      }
    }

    if (distinct.size > 1) {
      for (const [label, { row, count }] of distinct) {
        const { classification, fieldNotes } = classify(decision.identity, row.reasoned);
        worstNotes.push(
          `variant (${count}×, ${classification}): ${label}${fieldNotes.length ? " — " + fieldNotes.join("; ") : ""}`
        );
      }
    }

    counts[worst] += 1;
    const chosen = primary!;
    reportRows.push({
      concept: decision.concept,
      status: decision.status,
      fingerprint: decision.fingerprint,
      deliverableName: chosen.row.name,
      projectName: chosen.row.projectName,
      decisionIdentity: identityLabel(decision.identity),
      reasonedIdentity: chosen.label,
      reasoningSource: chosen.row.reasoningSource ?? "",
      classification: worst,
      fieldNotes: worstNotes.length ? worstNotes : chosen.fieldNotes,
      fragnet: chosen.row.parentWbs ?? chosen.row.wbsPath ?? "(none)",
      activities: chosen.row.relatedActivityNames,
      neighbours: chosen.row.neighbourNames,
      matchCount: reasonedMatches.length,
    });
  }

  const generatedAt = new Date().toISOString();
  const md: string[] = [];
  md.push("# Brain review decisions vs backfilled reasoned identities");
  md.push("");
  md.push("Read-only comparison report. No database writes. No changes recommended or applied.");
  md.push("");
  md.push(`- **Generated:** ${generatedAt}`);
  md.push(`- **Company:** ${companyId}`);
  md.push(`- **Decisions:** ${decisions.size}`);
  md.push(`- **Snapshot rows:** ${totalRows} (${reasonedRows} reasoned)`);
  md.push(
    "- **Matching:** same fingerprint basis as duration-stats (`conceptSubject` + rule-based identity → `engineeringIdentityFingerprint`)"
  );
  md.push("");
  md.push("## Summary");
  md.push("");
  md.push("| Classification | Count |");
  md.push("|---|---|");
  md.push(`| AGREE | ${counts.AGREE} |`);
  md.push(`| REASONING_MORE_COMPLETE | ${counts.REASONING_MORE_COMPLETE} |`);
  md.push(`| DISAGREE | ${counts.DISAGREE} |`);
  md.push(`| NO_REASONED_DATA | ${counts.NO_REASONED_DATA} |`);
  md.push(`| Decisions with no snapshot match | ${unmatchedDecisions} |`);
  md.push("");
  md.push("## Full comparison table");
  md.push("");
  md.push(
    "| # | Classification | Concept | Status | Deliverable | Project | Decision identity | Reasoned identity | Source | Field notes | Fragnet / WBS | Activities fed to reasoning | Neighbours |"
  );
  md.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");

  reportRows.forEach((row, index) => {
    const activities =
      row.activities.length > 0
        ? row.activities.map((a) => mdEscape(a)).join("<br>")
        : "*(none)*";
    const neighbours =
      row.neighbours.length > 0
        ? row.neighbours.map((n) => mdEscape(n)).join("<br>")
        : "*(none)*";
    const notes =
      row.fieldNotes.length > 0
        ? row.fieldNotes.map((n) => mdEscape(n)).join("<br>")
        : "—";
    md.push(
      `| ${index + 1} | **${row.classification}** | ${mdEscape(row.concept)} | ${mdEscape(row.status)} | ${mdEscape(row.deliverableName)} | ${mdEscape(row.projectName)} | \`${mdEscape(row.decisionIdentity)}\` | \`${mdEscape(row.reasonedIdentity)}\` | ${mdEscape(row.reasoningSource || "—")} | ${notes} | ${mdEscape(row.fragnet || "—")} | ${activities} | ${neighbours} |`
    );
  });

  md.push("");
  md.push("## Per-decision detail");
  md.push("");
  reportRows.forEach((row, index) => {
    md.push(`### ${index + 1}. ${row.concept}`);
    md.push("");
    md.push(`- **Classification:** ${row.classification}`);
    md.push(`- **Status:** ${row.status}`);
    md.push(`- **Fingerprint:** \`${row.fingerprint}\``);
    md.push(
      `- **Deliverable:** ${row.deliverableName}${row.projectName ? ` — ${row.projectName}` : ""}`
    );
    md.push(`- **Decision identity:** \`${row.decisionIdentity}\``);
    md.push(
      `- **Reasoned identity:** \`${row.reasonedIdentity}\` (source=${row.reasoningSource || "n/a"}, matched rows=${row.matchCount})`
    );
    md.push(`- **Fragnet / WBS:** ${row.fragnet || "(none)"}`);
    if (row.fieldNotes.length > 0) {
      md.push(`- **Field notes:**`);
      for (const note of row.fieldNotes) md.push(`  - ${note}`);
    }
    md.push(`- **Activities fed to reasoning (${row.activities.length}):**`);
    if (row.activities.length === 0) md.push(`  - *(none)*`);
    else for (const activity of row.activities) md.push(`  - ${activity}`);
    if (row.neighbours.length > 0) {
      md.push(`- **Neighbours:** ${row.neighbours.join("; ")}`);
    }
    md.push("");
  });

  md.push("---");
  md.push("");
  md.push("Regenerate with: `npx tsx scripts/report-brain-vs-reasoning.ts`");
  md.push("");

  writeFileSync(DEFAULT_MARKDOWN_PATH, md.join("\n"), "utf8");
  console.log(`\nWrote ${reportRows.length} rows to ${DEFAULT_MARKDOWN_PATH}`);
  console.log(
    JSON.stringify(
      {
        decisions: decisions.size,
        AGREE: counts.AGREE,
        REASONING_MORE_COMPLETE: counts.REASONING_MORE_COMPLETE,
        DISAGREE: counts.DISAGREE,
        NO_REASONED_DATA: counts.NO_REASONED_DATA,
        decisionsWithNoSnapshotMatch: unmatchedDecisions,
        snapshotRows: totalRows,
        reasonedSnapshotRows: reasonedRows,
      },
      null,
      2
    )
  );
  process.exit(0);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
