/**
 * Document-type extraction — internal classification signal only.
 * Separates document form (Report, Drawing, …) from engineering discipline.
 */

export type DocumentTypeId =
  | "technical_note"
  | "design_drawing"
  | "drawing"
  | "general_arrangement"
  | "elevation"
  | "schedule"
  | "specification"
  | "report"
  | "calculation"
  | "model"
  | "survey"
  | "strategy"
  | "assessment"
  | "analysis"
  | "register"
  | "checklist"
  | "programme"
  | "method_statement";

export type ExtractedDocumentType = {
  id: DocumentTypeId;
  label: string;
  /** Canonical match phrase used as a WP scoring signal */
  matchText: string;
  /** Normalised name with the document-type span removed */
  residualSubject: string;
};

type DocumentTypeRule = {
  id: DocumentTypeId;
  label: string;
  matchText: string;
  /** Matched against already-normalised lowercase text; longest / first wins */
  patterns: string[];
};

/**
 * Ordered most-specific first so "design drawing" wins over bare "drawing",
 * and "technical note" wins over unrelated short tokens.
 */
export const DOCUMENT_TYPE_RULES: DocumentTypeRule[] = [
  { id: "method_statement", label: "Method Statement", matchText: "method statement", patterns: ["method\\s+statements?", "method\\s+stmt"] },
  { id: "technical_note", label: "Technical Note", matchText: "technical notes", patterns: ["technical\\s+notes?"] },
  { id: "general_arrangement", label: "General Arrangement", matchText: "general arrangements", patterns: ["general\\s+arrangements?", "\\bg\\.?a\\.?\\b"] },
  { id: "design_drawing", label: "Design Drawing", matchText: "design drawings", patterns: ["design\\s+drawings?"] },
  { id: "specification", label: "Specification", matchText: "specifications", patterns: ["equipment\\s+specifications?", "specifications?", "specs?"] },
  { id: "elevation", label: "Elevation", matchText: "elevations", patterns: ["elevations?"] },
  { id: "schedule", label: "Schedule", matchText: "schedules", patterns: ["design\\s+schedules?", "schedules?"] },
  { id: "calculation", label: "Calculation", matchText: "calculations", patterns: ["calculations?", "calcs?"] },
  { id: "assessment", label: "Assessment", matchText: "assessment", patterns: ["assessments?"] },
  { id: "analysis", label: "Analysis", matchText: "analysis", patterns: ["analysis", "analyses"] },
  { id: "strategy", label: "Strategy", matchText: "strategy", patterns: ["strateg(?:y|ies)"] },
  { id: "survey", label: "Survey", matchText: "survey", patterns: ["surveys?"] },
  { id: "register", label: "Register", matchText: "register", patterns: ["registers?"] },
  { id: "checklist", label: "Checklist", matchText: "checklist", patterns: ["check\\s*lists?"] },
  { id: "programme", label: "Programme", matchText: "programme", patterns: ["programmes?", "programs?"] },
  { id: "report", label: "Report", matchText: "report", patterns: ["reports?"] },
  { id: "model", label: "Model", matchText: "model", patterns: ["\\bmodels?\\b", "\\bbim\\b"] },
  { id: "drawing", label: "Drawing", matchText: "drawings", patterns: ["drawings?"] },
];

const COMPILED_DOCUMENT_TYPE_RULES = DOCUMENT_TYPE_RULES.map((rule) => ({
  ...rule,
  compiledPatterns: rule.patterns.map((pattern) => new RegExp(pattern, "i")),
}));

function longestMatch(text: string, patterns: RegExp[]): { index: number; length: number; matched: string } | null {
  let best: { index: number; length: number; matched: string } | null = null;
  for (const re of patterns) {
    const m = text.match(re);
    if (!m || m.index == null) continue;
    const matched = m[0] ?? "";
    if (!best || matched.length > best.length) {
      best = { index: m.index, length: matched.length, matched };
    }
  }
  return best;
}

/**
 * Extract a canonical document type from a normalised deliverable name.
 * Does not determine discipline — scoring aid only.
 */
export function extractDocumentType(normalisedName: string): ExtractedDocumentType | null {
  const text = String(normalisedName ?? "").trim().toLowerCase();
  if (!text) return null;

  let best: {
    rule: DocumentTypeRule;
    index: number;
    length: number;
  } | null = null;

  for (const rule of COMPILED_DOCUMENT_TYPE_RULES) {
    const hit = longestMatch(text, rule.compiledPatterns);
    if (!hit) continue;
    if (
      !best ||
      hit.length > best.length ||
      (hit.length === best.length && hit.index < best.index)
    ) {
      best = { rule, index: hit.index, length: hit.length };
    }
  }

  if (!best) return null;

  const residualSubject = `${text.slice(0, best.index)} ${text.slice(best.index + best.length)}`
    .replace(/\s+/g, " ")
    .trim();

  return {
    id: best.rule.id,
    label: best.rule.label,
    matchText: best.rule.matchText,
    residualSubject,
  };
}

/**
 * Build scoring texts for work-package matching: full name, document type,
 * residual subject, and planner-style subject+type compositions.
 */
export function documentTypeMatchTexts(
  normalisedName: string,
  docType: ExtractedDocumentType | null
): string[] {
  const texts = [normalisedName];
  if (!docType) return texts;

  texts.push(docType.matchText);
  if (docType.residualSubject) {
    texts.push(docType.residualSubject);
    texts.push(`${docType.residualSubject} ${docType.matchText}`);
    texts.push(`${docType.matchText} ${docType.residualSubject}`);
  }
  return [...new Set(texts.map((t) => t.trim()).filter(Boolean))];
}

/**
 * Soft affinity bonus when a work package's identity aligns with the document type.
 * Weighted signal — not a hard table of discipline×type combinations.
 */
export function documentTypeAffinityBonus(
  workPackage: { id: string; label: string; deliverablePatterns: Array<string | { pattern: string }>; aliases?: Array<string | { pattern: string }> },
  docType: ExtractedDocumentType | null
): number {
  if (!docType) return 0;

  const hay = [
    workPackage.id.replace(/_/g, " "),
    workPackage.label.toLowerCase(),
    ...workPackage.deliverablePatterns.map((p) => (typeof p === "string" ? p : p.pattern).toLowerCase()),
    ...(workPackage.aliases ?? []).map((p) => (typeof p === "string" ? p : p.pattern).toLowerCase()),
  ].join(" ");

  const needles = [
    docType.id.replace(/_/g, " "),
    docType.matchText,
    docType.label.toLowerCase(),
  ];

  let bonus = 0;
  for (const needle of needles) {
    if (!needle) continue;
    if (hay.includes(needle)) bonus = Math.max(bonus, 28);
    // Plural / stem soft matches: report↔reports, drawing↔drawings
    const stem = needle.replace(/s$/, "");
    if (stem.length >= 4 && hay.includes(stem)) bonus = Math.max(bonus, 22);
  }

  // Generic document-family affinity
  if (docType.id === "drawing" || docType.id === "design_drawing") {
    if (/\bdrawing/.test(hay) || /\barrangement/.test(hay) || /\belevation/.test(hay)) {
      bonus = Math.max(bonus, 20);
    }
  }
  if (docType.id === "report" && /\breport/.test(hay)) bonus = Math.max(bonus, 24);
  if (docType.id === "strategy" && /\bstrateg/.test(hay)) bonus = Math.max(bonus, 26);
  if (docType.id === "technical_note" && /\btechnical note/.test(hay)) bonus = Math.max(bonus, 28);
  if (docType.id === "specification" && /\bspec/.test(hay)) bonus = Math.max(bonus, 24);
  if (docType.id === "survey" && /\bsurvey/.test(hay)) bonus = Math.max(bonus, 24);
  if (docType.id === "general_arrangement" && /\barrangement/.test(hay)) bonus = Math.max(bonus, 28);
  if (docType.id === "model" && /\bmodel/.test(hay)) bonus = Math.max(bonus, 22);
  if (docType.id === "schedule" && /\bschedule/.test(hay)) bonus = Math.max(bonus, 22);
  if (docType.id === "elevation" && /\belevation/.test(hay)) bonus = Math.max(bonus, 24);
  if (docType.id === "assessment" && (/\bassess/.test(hay) || /\bbreeam/.test(hay))) bonus = Math.max(bonus, 20);

  return bonus;
}
