import type { AskRanaEvidencePackage } from "./askRana.types.js";

function section(title: string, body: string[]): string {
  const lines = body.filter(Boolean);
  if (lines.length === 0) return "";
  return `## ${title}\n${lines.map((l) => `- ${l}`).join("\n")}`;
}

/** Serialize the evidence package into planner-readable briefing text for the LLM. */
export function serializeAskRanaEvidenceForPrompt(
  pkg: AskRanaEvidencePackage,
  opts?: { relevantGapsOnly?: string[]; omitGapsSection?: boolean }
): string {
  const parts: string[] = [];

  parts.push(
    section("Deliverable", [
      `Name: ${pkg.deliverable.name}`,
      pkg.deliverable.classification ? `Classification: ${pkg.deliverable.classification}` : "",
      pkg.deliverable.currentDurationDays != null
        ? `Current planned duration: ${pkg.deliverable.currentDurationDays} days`
        : "",
    ])
  );

  if (pkg.previousProjects?.available) {
    const p = pkg.previousProjects;
    parts.push(
      section("Previous completed projects", [
        p.comparisonAssessment ? `Assessment: ${p.comparisonAssessment}` : "",
        p.typicalRangeLabel ? `Typical planned duration range on similar work: ${p.typicalRangeLabel}` : "",
        p.typicalDurationDays != null ? `Typical planned duration: around ${p.typicalDurationDays} days` : "",
        p.sampleSize > 0
          ? `Based on ${p.completedProjectCount} completed project${p.completedProjectCount === 1 ? "" : "s"} · ${p.sampleSize} comparable work package${p.sampleSize === 1 ? "" : "s"}`
          : "No completed projects available for comparison yet",
        ...p.comparableWork.slice(0, 6).map(
          (w) =>
            `${w.deliverableName} on ${w.projectName}${w.durationDays != null ? ` — ${w.durationDays} days planned` : ""}`
        ),
        ...p.observations,
      ])
    );
  } else if (pkg.sources.includes("previousProjects") && !opts?.omitGapsSection) {
    // Omitted from briefing — verification layer handles relevant gap messaging
  }

  if (pkg.projectEvolution?.available) {
    const e = pkg.projectEvolution;
    parts.push(
      section("This project's revisions", [
        e.summary ? `Summary: ${e.summary}` : "",
        e.baselineDays != null && e.latestDays != null
          ? `Remaining work: baseline ${e.baselineDays} days → latest ${e.latestDays} days${e.netChangeDays != null ? ` (net ${e.netChangeDays > 0 ? "+" : ""}${e.netChangeDays})` : ""}`
          : "",
        e.trend ? `Remaining-work trend: ${e.trend}` : "",
        e.changePattern ? `Change pattern: ${e.changePattern}` : "",
        e.volatility ? `Volatility: ${e.volatility}` : "",
        e.howChangedSummary ? `How remaining work changed: ${e.howChangedSummary}` : "",
        ...e.timelineHighlights,
        ...e.plannerObservations,
        ...e.revisionHighlights.map(
          (h) => `${h.label}: ${h.durationDays} days remaining work${h.changeDays != null ? ` (${h.changeDays > 0 ? "+" : ""}${h.changeDays})` : ""} — ${h.reason}`
        ),
        ...e.stablePeriods.map(
          (s) => `Remaining work stable at ${s.durationDays} days from ${s.startLabel} to ${s.endLabel} (${s.revisionCount} revisions)`
        ),
      ])
    );

    if (e.revisions.length > 0 && e.showFullTimeline) {
      parts.push(
        section(
          "Revision timeline",
          e.revisions.map((r) => {
              const date = r.importedAt ? new Date(r.importedAt).toLocaleDateString("en-GB") : "";
              const change =
                r.durationChangeDays != null && r.durationChangeDays !== 0
                  ? ` (${r.durationChangeDays > 0 ? "+" : ""}${r.durationChangeDays})`
                  : "";
            return `${r.label}${r.role ? ` [${r.role}]` : ""}: ${r.durationDays ?? "—"} days remaining work${change}${date ? `, imported ${date}` : ""}`;
          })
        )
      );
    }
  } else if (pkg.sources.includes("projectEvolution") && !opts?.omitGapsSection) {
    // Omitted from briefing — verification layer handles relevant gap messaging
  }

  if (pkg.programmeLogic?.available) {
    const logic = pkg.programmeLogic;
    const logicLines: string[] = [];
    if (logic.summary) logicLines.push(`Summary: ${logic.summary}`);
    for (const rev of logic.revisions) {
      if (rev.events.length === 0 && rev.plannerObservations.length === 0) continue;
      logicLines.push(`--- ${rev.label} ---`);
      if (rev.relationshipCountChange != null && rev.relationshipCountChange !== 0) {
        logicLines.push(
          `Relationship count change: ${rev.relationshipCountChange > 0 ? "+" : ""}${rev.relationshipCountChange}`
        );
      }
      for (const obs of rev.plannerObservations.slice(0, 6)) {
        logicLines.push(obs);
      }
      for (const ev of rev.events.slice(0, 8)) {
        logicLines.push(ev.description);
      }
    }
    parts.push(section("Programme logic evolution (relationships, lag, float, criticality)", logicLines));
  }

  if (pkg.recommendations?.available && pkg.recommendations.items.length > 0) {
    parts.push(
      section(
        "Recommendations already generated",
        pkg.recommendations.items.map((r) => `${r.title}: ${r.summary || r.recommendation}`)
      )
    );
  }

  if (pkg.observations && pkg.observations.length > 0) {
    parts.push(section("Observations", pkg.observations));
  }

  if (pkg.keyFactors && pkg.keyFactors.length > 0) {
    parts.push(section("Key factors", pkg.keyFactors));
  }

  if (pkg.trust?.available) {
    parts.push(
      section("Evidence quality", [
        pkg.trust.band ? `Overall: ${pkg.trust.band}` : "",
        pkg.trust.summary ?? "",
      ])
    );
  }

  if (pkg.lessonsLearned?.available && pkg.lessonsLearned.items.length > 0) {
    parts.push(
      section(
        "Lessons from previous projects",
        pkg.lessonsLearned.items.slice(0, 5).map((l) => `${l.title}: ${l.summary}`)
      )
    );
  }

  if (pkg.similarProjects?.available && pkg.similarProjects.items.length > 0) {
    parts.push(
      section(
        "Similar completed projects",
        pkg.similarProjects.items.slice(0, 5).map((p) => {
          const expl = p.explanations.length ? ` (${p.explanations[0]})` : "";
          return `${p.projectName} — ${p.similarityPhrase}${expl}`;
        })
      )
    );
  }

  if (!opts?.omitGapsSection && opts?.relevantGapsOnly && opts.relevantGapsOnly.length > 0) {
    parts.push(section("Relevant limitations for this question", opts.relevantGapsOnly));
  }

  return parts.filter(Boolean).join("\n\n");
}
