import type { AskRanaEvidencePackage } from "./askRana.types.js";
import type { PlannerQuery } from "./askRanaPlannerQuery.types.js";

const ATTRIBUTE_PATTERN = /\b(duration|float|critical|logic|relationship|lag|dependency|dependencies)\b/i;

const WHOLE_PROJECT_EVOLUTION_PATTERNS = [
  /\bsummar(?:y|ise|ize)\s+(?:the\s+)?evolution\b/i,
  /\bstory of this deliverable\b/i,
  /\bhow has (?:this|it) changed over time\b/i,
  /\bwalk me through (?:the\s+)?revisions?\b/i,
  /\b(?:show (?:me )?(?:the )?)?revision history\b/i,
  /\bshow (?:me )?(?:the )?timeline\b/i,
  /\bexplain everything\b/i,
  /\bacross (?:all )?revisions?\b/i,
  /\bover time\b/i,
];

const FLOAT_EVENT_TYPES = new Set([
  "FLOAT_LOST",
  "FLOAT_GAINED",
  "APPROACHING_CRITICAL",
  "NEGATIVE_FLOAT_INTRODUCED",
]);

const CRITICALITY_EVENT_TYPES = new Set(["BECAME_CRITICAL", "LEFT_CRITICAL"]);

const LOGIC_EVENT_TYPES = new Set([
  "RELATIONSHIP_ADDED",
  "RELATIONSHIP_REMOVED",
  "RELATIONSHIP_TYPE_CHANGED",
  "LAG_INCREASED",
  "LAG_DECREASED",
  "LAG_INTRODUCED",
  "LAG_REMOVED",
]);

type RevisionChangeProfile = {
  label: string;
  duration: "changed" | "unchanged" | "unknown";
  durationPhrase: string | null;
  floatChanged: boolean;
  floatPhrase: string | null;
  criticalityChanged: boolean;
  criticalityPhrase: string | null;
  logicChanged: boolean;
  logicPhrase: string | null;
};

/** Questions that warrant a whole-project chronological story. */
export function isWholeProjectEvolutionQuestion(
  question: string,
  plannerQuery?: PlannerQuery
): boolean {
  const q = question.trim();
  if (WHOLE_PROJECT_EVOLUTION_PATTERNS.some((pattern) => pattern.test(q))) return true;
  if (plannerQuery?.intent === "revision_history") return true;
  if (plannerQuery?.intent === "summary" && /\b(?:deliverable|evolution|revisions?)\b/i.test(q)) {
    return true;
  }
  if (plannerQuery?.timeframe === "full_history") return true;
  return false;
}

function revisionOrder(pkg: AskRanaEvidencePackage): string[] {
  const order: string[] = [];
  for (const r of pkg.projectEvolution?.revisions ?? []) {
    if (!order.includes(r.label)) order.push(r.label);
  }
  for (const h of pkg.projectEvolution?.revisionHighlights ?? []) {
    if (!order.includes(h.label)) order.push(h.label);
  }
  for (const rev of pkg.programmeLogic?.revisions ?? []) {
    if (!order.includes(rev.label)) order.push(rev.label);
  }
  return order;
}

function resolveLatestLabel(pkg?: AskRanaEvidencePackage): string {
  const revisions = pkg?.projectEvolution?.revisions ?? [];
  if (revisions.length === 0) return "Update";
  return revisions[revisions.length - 1]!.label;
}

function normalizeRevisionLabel(label: string, pkg?: AskRanaEvidencePackage): string {
  if (!pkg) return label;
  if (/^latest\s+update$/i.test(label)) {
    return resolveLatestLabel(pkg);
  }
  const known = revisionOrder(pkg);
  const exact = known.find((r) => r.toLowerCase() === label.toLowerCase());
  if (exact) return exact;
  const fuzzy = known.find(
    (r) => r.replace(/\s+/g, "").toLowerCase() === label.replace(/\s+/g, "").toLowerCase()
  );
  return fuzzy ?? label;
}

/** Planner named a specific revision — answer that revision first. */
export function extractRevisionTarget(
  question: string,
  pkg?: AskRanaEvidencePackage
): string | null {
  if (isWholeProjectEvolutionQuestion(question)) return null;

  const q = question.trim();

  if (/\bsince\s+baseline\b/i.test(q) || /\bfrom\s+baseline\s+to\b/i.test(q)) return null;

  const updateMatch = q.match(/\bupdate\s+(\d+)\b/i);
  if (updateMatch) {
    return normalizeRevisionLabel(`Update ${updateMatch[1]}`, pkg);
  }

  if (/\bas[- ]?built\b/i.test(q)) {
    return normalizeRevisionLabel("As-built", pkg);
  }

  if (/\blatest\s+update\b/i.test(q)) {
    return normalizeRevisionLabel(resolveLatestLabel(pkg), pkg);
  }

  if (
    /\b(?:in|at|for|during|about|regarding)\s+(?:the\s+)?latest\b/i.test(q) ||
    /\bwhat (?:changed|happened).*\blatest\b/i.test(q)
  ) {
    return normalizeRevisionLabel(resolveLatestLabel(pkg), pkg);
  }

  if (
    /\b(?:in|at|for|during|about|story of|what happened|what changed)\s+(?:in\s+)?(?:the\s+)?baseline\b/i.test(q) ||
    /\bwhat changed (?:in|at|for) baseline\b/i.test(q)
  ) {
    return normalizeRevisionLabel("Baseline", pkg);
  }

  return null;
}

/** "What changed?" without naming duration, float, logic, or a specific revision. */
export function isBroadChangeQuestion(question: string, plannerQuery?: PlannerQuery): boolean {
  const q = question.trim().toLowerCase();
  if (extractRevisionTarget(question)) return false;
  const asksWhatChanged =
    plannerQuery?.intent === "what_changed" || /\bwhat\s+changed\b/.test(q);
  if (!asksWhatChanged) return false;
  if (ATTRIBUTE_PATTERN.test(q)) return false;
  if (plannerQuery?.qualifiers.some((qual) => ATTRIBUTE_PATTERN.test(qual))) return false;
  return true;
}

/** Replace repetitive system-style wording with planner-facing language. */
export function humanizePlannerPhrase(text: string): string {
  return text
    .replace(
      /\bthe imported programme history does not record why\b/gi,
      "the programme file does not explain why"
    )
    .replace(
      /\bthe programme history records how .+?, but not why\b/gi,
      (m) => m.replace("the programme history records", "the revisions show").replace(", but not why", " — why is not in the programme file")
    )
    .replace(
      /\bunderlying planner rationale for individual planning decisions is not recorded in the imported programme\.?/gi,
      "Why each planning decision was made is not in the programme file."
    )
    .replace(
      /\bnot recorded in the imported programme\b/gi,
      "not in the programme file"
    )
    .replace(/\bimported programme evidence\b/gi, "programme evidence")
    .replace(/\bimported programme history\b/gi, "revision history")
    .replace(/\bimported programme\b/gi, "programme");
}

function revisionProfile(label: string, profiles: Map<string, RevisionChangeProfile>): RevisionChangeProfile {
  const existing = profiles.get(label);
  if (existing) return existing;
  const profile: RevisionChangeProfile = {
    label,
    duration: "unknown",
    durationPhrase: null,
    floatChanged: false,
    floatPhrase: null,
    criticalityChanged: false,
    criticalityPhrase: null,
    logicChanged: false,
    logicPhrase: null,
  };
  profiles.set(label, profile);
  return profile;
}

function firstPhrase(...candidates: Array<string | null | undefined>): string | null {
  for (const c of candidates) {
    const t = String(c ?? "").trim();
    if (t) return t;
  }
  return null;
}

/** Build per-revision change summaries from evidence already in the package — no new calculations. */
export function buildRevisionChangeSummaries(pkg: AskRanaEvidencePackage): string[] {
  const evo = pkg.projectEvolution;
  if (!evo?.available) return [];

  const profiles = new Map<string, RevisionChangeProfile>();

  for (const h of evo.revisionHighlights ?? []) {
    const p = revisionProfile(h.label, profiles);
    if (h.changeDays != null && h.changeDays !== 0) {
      p.duration = "changed";
      p.durationPhrase = `remaining work moved ${h.changeDays > 0 ? "+" : ""}${h.changeDays} days`;
    } else if (h.changeDays === 0) {
      p.duration = "unchanged";
    } else if (h.reason && /unchanged|stable|no change/i.test(h.reason)) {
      p.duration = "unchanged";
    }
  }

  for (const rev of pkg.programmeLogic?.revisions ?? []) {
    const p = revisionProfile(rev.label, profiles);
    for (const ev of rev.events) {
      if (FLOAT_EVENT_TYPES.has(ev.type)) {
        p.floatChanged = true;
        p.floatPhrase = firstPhrase(p.floatPhrase, ev.description);
      }
      if (CRITICALITY_EVENT_TYPES.has(ev.type)) {
        p.criticalityChanged = true;
        p.criticalityPhrase = firstPhrase(p.criticalityPhrase, ev.description);
      }
      if (LOGIC_EVENT_TYPES.has(ev.type) || ev.type.startsWith("LAG_")) {
        p.logicChanged = true;
        p.logicPhrase = firstPhrase(p.logicPhrase, ev.description);
      }
    }
    for (const obs of rev.plannerObservations) {
      if (/duration was unchanged|duration unchanged|no duration change/i.test(obs)) {
        p.duration = "unchanged";
      }
      if (/became critical/i.test(obs)) {
        p.criticalityChanged = true;
        p.criticalityPhrase = firstPhrase(p.criticalityPhrase, obs);
      }
      if (/left the critical path/i.test(obs)) {
        p.criticalityChanged = true;
        p.criticalityPhrase = firstPhrase(p.criticalityPhrase, obs);
      }
    }
  }

  const order: string[] = [];
  for (const r of evo.revisions ?? []) {
    if (!order.includes(r.label)) order.push(r.label);
  }
  for (const h of evo.revisionHighlights ?? []) {
    if (!order.includes(h.label)) order.push(h.label);
  }
  for (const rev of pkg.programmeLogic?.revisions ?? []) {
    if (!order.includes(rev.label)) order.push(rev.label);
  }

  const summaries: string[] = [];
  for (const label of order) {
    const p = profiles.get(label);
    if (p) summaries.push(formatRevisionChangeSummary(p));
  }

  if (summaries.length === 0 && evo.howChangedSummary) {
    summaries.push(humanizePlannerPhrase(evo.howChangedSummary));
  }

  return summaries.slice(0, 8);
}

export function buildSingleRevisionChangeSummary(
  pkg: AskRanaEvidencePackage,
  targetLabel: string
): string | null {
  const summaries = buildRevisionChangeSummaries(pkg);
  return (
    summaries.find(
      (s) => s.startsWith(`${targetLabel}:`) || s.startsWith(`${targetLabel} did`)
    ) ?? null
  );
}

function formatRevisionChangeSummary(p: RevisionChangeProfile): string {
  const changes: string[] = [];
  const explicitlyUnchanged: string[] = [];

  if (p.duration === "changed" && p.durationPhrase) {
    changes.push(p.durationPhrase);
  } else if (p.duration === "unchanged") {
    explicitlyUnchanged.push("duration");
  }

  if (p.floatChanged) {
    changes.push(firstPhrase(p.floatPhrase, "float / scheduling flexibility changed")!);
  } else {
    explicitlyUnchanged.push("float");
  }

  if (p.criticalityChanged) {
    changes.push(firstPhrase(p.criticalityPhrase, "criticality changed")!);
  } else {
    explicitlyUnchanged.push("criticality");
  }

  if (p.logicChanged) {
    changes.push(firstPhrase(p.logicPhrase, "logic or relationships changed")!);
  } else {
    explicitlyUnchanged.push("logic");
  }

  if (changes.length === 0) {
    return `${p.label}: no recorded changes to duration, float, criticality, or logic.`;
  }

  if (changes.length === 1 && explicitlyUnchanged.length > 0) {
    return `${p.label} did not change ${explicitlyUnchanged.join(" or ")}. The only recorded change was ${changes[0]}.`;
  }

  const unchangedNote =
    explicitlyUnchanged.length > 0 ? ` No change to ${explicitlyUnchanged.join(", ")}.` : "";
  return `${p.label}: ${changes.join("; ")}.${unchangedNote}`;
}

export function buildStoryFlowGuidance(
  pkg: AskRanaEvidencePackage,
  question?: string
): string | null {
  const evo = pkg.projectEvolution;
  if (!evo?.available || (evo.revisionCount ?? 0) <= 1) return null;
  if (question) {
    if (extractRevisionTarget(question, pkg)) return null;
    if (!isWholeProjectEvolutionQuestion(question) && !isBroadChangeQuestion(question)) {
      return null;
    }
  }

  const labels = [
    ...new Set([
      ...(evo.revisions?.map((r) => r.label) ?? []),
      ...(evo.revisionHighlights?.map((h) => h.label) ?? []),
    ]),
  ];
  if (labels.length < 2) return null;

  return [
    "Tell the story chronologically: Baseline → early updates → later updates → current position.",
    "Use transitions rather than repeating the same revision name in every sentence.",
    "Group minor updates when the evidence shows a stable period.",
  ].join(" ");
}

export function buildRevisionScopedGuidance(targetLabel: string): string {
  return [
    `The planner asked about ${targetLabel} specifically.`,
    `Start with ${targetLabel} only — what was recorded for duration, float, criticality, and logic/relationships in that revision.`,
    `Only afterwards, add brief context from earlier or later revisions if it genuinely helps explain ${targetLabel}.`,
    "Never open with Baseline or a full revision-by-revision walkthrough.",
  ].join(" ");
}

/** Neighbouring revisions with recorded changes — supporting context only. */
export function buildRevisionNeighborContext(
  pkg: AskRanaEvidencePackage,
  targetLabel: string
): string[] {
  const order = revisionOrder(pkg);
  const idx = order.indexOf(targetLabel);
  if (idx < 0) return [];

  const context: string[] = [];

  for (let i = idx - 1; i >= 0; i--) {
    const summary = buildSingleRevisionChangeSummary(pkg, order[i]!);
    if (summary && !/no recorded changes/i.test(summary)) {
      context.push(`Earlier supporting context — ${summary}`);
      break;
    }
  }

  for (let i = idx + 1; i < order.length; i++) {
    const summary = buildSingleRevisionChangeSummary(pkg, order[i]!);
    if (summary && !/no recorded changes/i.test(summary)) {
      context.push(`Later supporting context — ${summary}`);
      break;
    }
  }

  return context.slice(0, 2);
}

/** Facts for the requested revision — project-wide summaries excluded. */
export function collectRevisionFocusedFacts(
  pkg: AskRanaEvidencePackage,
  targetLabel: string
): string[] {
  const facts: string[] = [];
  const d = pkg.deliverable;

  if (d.name) facts.push(`Deliverable: ${d.name}`);

  const evo = pkg.projectEvolution;
  if (evo?.available) {
    for (const h of evo.revisionHighlights ?? []) {
      if (h.label === targetLabel) {
        facts.push(
          `${h.label}: ${h.durationDays} days${h.changeDays != null ? ` (${h.changeDays > 0 ? "+" : ""}${h.changeDays})` : ""} — ${h.reason}`
        );
      }
    }
    const rev = evo.revisions?.find((r) => r.label === targetLabel);
    if (rev?.durationDays != null) {
      facts.push(
        `${targetLabel} remaining work: ${rev.durationDays} days` +
          (rev.durationChangeDays != null && rev.durationChangeDays !== 0
            ? ` (${rev.durationChangeDays > 0 ? "+" : ""}${rev.durationChangeDays} from previous revision)`
            : "")
      );
    }
  }

  const logic = pkg.programmeLogic;
  if (logic?.available) {
    const targetRev = logic.revisions.find((r) => r.label === targetLabel);
    if (targetRev) {
      for (const ev of targetRev.events.slice(0, 8)) {
        if (ev.description) facts.push(`${targetLabel}: ${ev.description}`);
      }
      for (const obs of targetRev.plannerObservations.slice(0, 6)) {
        facts.push(`${targetLabel}: ${obs}`);
      }
    }
  }

  const summary = buildSingleRevisionChangeSummary(pkg, targetLabel);
  if (summary) facts.push(summary);

  return [...new Set(facts.filter(Boolean).map(humanizePlannerPhrase))];
}

export function buildBroadChangeGuidance(): string {
  return [
    "The planner asked what changed without naming an attribute.",
    "Summarise every recorded change across duration, float, criticality, and logic/relationships.",
    "Use “no change” only when the comparison found nothing different.",
    "Use “not in the programme file” for missing rationale or metadata — never mix those ideas.",
    "When only one attribute changed, state explicitly that the others did not.",
    "If the evidence supports a single reading, say “The revision history shows…” — do not hedge unnecessarily.",
  ].join(" ");
}

export function humanizeUnknowns(unknowns: string[]): string[] {
  return [...new Set(unknowns.map(humanizePlannerPhrase).filter(Boolean))].slice(0, 6);
}
