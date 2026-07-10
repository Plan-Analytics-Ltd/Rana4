import type {
  PlannerComparisonMode,
  PlannerEvidenceScope,
  PlannerQuery,
  PlannerQueryEntity,
  PlannerQueryIntent,
  PlannerTimeframe,
} from "./askRanaPlannerQuery.types.js";

type ScopeMatch = {
  scope: Exclude<PlannerEvidenceScope, "AUTO">;
  weight: number;
  label: string;
};

type IntentMatch = {
  intent: PlannerQueryIntent;
  weight: number;
  label: string;
};

const SCOPE_PATTERNS: ScopeMatch[] = [
  {
    scope: "PROJECT_EVOLUTION",
    weight: 0.96,
    label: "planner asked for project-evolution level assessment",
  },
  {
    scope: "PROJECT_EVOLUTION",
    weight: 0.94,
    label: "planner excluded previous-project comparison",
  },
  {
    scope: "PROJECT_EVOLUTION",
    weight: 0.93,
    label: "planner limited answer to revision history",
  },
  {
    scope: "PROJECT_EVOLUTION",
    weight: 0.9,
    label: "planner referenced this project's evolution",
  },
  {
    scope: "PROJECT_EVOLUTION",
    weight: 0.88,
    label: "planner asked about revision history on this project",
  },
  {
    scope: "PROJECT_EVOLUTION",
    weight: 0.86,
    label: "planner asked about changes through updates",
  },
  {
    scope: "PREVIOUS_PROJECTS",
    weight: 0.96,
    label: "planner asked for comparison with previous completed projects",
  },
  {
    scope: "PREVIOUS_PROJECTS",
    weight: 0.92,
    label: "planner asked about completed projects",
  },
  {
    scope: "PREVIOUS_PROJECTS",
    weight: 0.9,
    label: "planner asked for historical comparison",
  },
  {
    scope: "BOTH",
    weight: 0.9,
    label: "planner asked for both revision history and previous-project comparison",
  },
  {
    scope: "PORTFOLIO",
    weight: 0.94,
    label: "planner asked portfolio-wide",
  },
  {
    scope: "PORTFOLIO",
    weight: 0.9,
    label: "planner asked organisation-wide",
  },
  {
    scope: "PROGRAMME",
    weight: 0.85,
    label: "planner asked at programme level",
  },
];

const SCOPE_REGEX: Array<ScopeMatch & { pattern: RegExp }> = [
  {
    ...SCOPE_PATTERNS[0]!,
    pattern: /\bon project evolution level\b/i,
  },
  {
    ...SCOPE_PATTERNS[1]!,
    pattern: /\bignor(?:ing|e)\s+previous\s+projects?\b/i,
  },
  {
    ...SCOPE_PATTERNS[1]!,
    pattern: /\bwithout\s+previous\s+projects?\b/i,
  },
  {
    ...SCOPE_PATTERNS[1]!,
    pattern: /\bnot\s+compar(?:e|ing)\s+(?:to|with)\s+previous\b/i,
  },
  {
    ...SCOPE_PATTERNS[2]!,
    pattern: /\bbased only on revisions?\b/i,
  },
  {
    ...SCOPE_PATTERNS[2]!,
    pattern: /\bfrom revisions? alone\b/i,
  },
  {
    ...SCOPE_PATTERNS[3]!,
    pattern: /\bthis project(?:'s)?\s+evolution\b/i,
  },
  {
    ...SCOPE_PATTERNS[3]!,
    pattern: /\b(?:from a )?programme logic perspective\b/i,
  },
  {
    ...SCOPE_PATTERNS[3]!,
    pattern: /\bon this project\b/i,
  },
  {
    ...SCOPE_PATTERNS[3]!,
    pattern: /\bproject evolution\b/i,
  },
  {
    ...SCOPE_PATTERNS[4]!,
    pattern: /\brevision history\b/i,
  },
  {
    ...SCOPE_PATTERNS[4]!,
    pattern: /\bthrough revisions?\b/i,
  },
  {
    ...SCOPE_PATTERNS[5]!,
    pattern: /\bbased on (?:the )?updates?\b/i,
  },
  {
    ...SCOPE_PATTERNS[5]!,
    pattern: /\bacross revisions?\b/i,
  },
  {
    ...SCOPE_PATTERNS[6]!,
    pattern: /\bcompar(?:e|ed|ing)\s+(?:to|with)\s+previous\s+(?:completed\s+)?projects?\b/i,
  },
  {
    ...SCOPE_PATTERNS[6]!,
    pattern: /\bagainst\s+previous\s+(?:completed\s+)?projects?\b/i,
  },
  {
    ...SCOPE_PATTERNS[6]!,
    pattern: /\bvs\.?\s+previous\s+projects?\b/i,
  },
  {
    ...SCOPE_PATTERNS[7]!,
    pattern: /\bcompleted projects?\b/i,
  },
  {
    ...SCOPE_PATTERNS[8]!,
    pattern: /\bprevious\s+completed\s+projects?\b/i,
  },
  {
    ...SCOPE_PATTERNS[9]!,
    pattern: /\bevolution\s+and\s+previous\s+projects?\b/i,
  },
  {
    ...SCOPE_PATTERNS[9]!,
    pattern: /\bprevious\s+projects?\s+and\s+(?:this\s+)?revision/i,
  },
  {
    ...SCOPE_PATTERNS[10]!,
    pattern: /\bportfolio[- ]wide\b/i,
  },
  {
    ...SCOPE_PATTERNS[11]!,
    pattern: /\b(?:organisation|organization)[- ]wide\b/i,
  },
  {
    ...SCOPE_PATTERNS[11]!,
    pattern: /\bacross (?:all )?projects?\b/i,
  },
  {
    ...SCOPE_PATTERNS[12]!,
    pattern: /\b(?:this|the)\s+programme\b/i,
  },
];

const INTENT_REGEX: Array<IntentMatch & { pattern: RegExp }> = [
  {
    intent: "investigate",
    weight: 0.96,
    label: "planner asked for a deep investigation",
    pattern: /\binvestigate(?:\s+further)?\b/i,
  },
  {
    intent: "investigate",
    weight: 0.93,
    label: "planner asked to find out what happened",
    pattern: /\b(?:find out|look into)\b/i,
  },
  {
    intent: "investigate",
    weight: 0.92,
    label: "planner asked for analysis",
    pattern: /\b(?:analys(?:e|is)|walk me through)\b/i,
  },
  {
    intent: "is_reasonable",
    weight: 0.95,
    label: "planner asked whether duration is reasonable",
    pattern: /\b(?:is|are)\s+(?:this|the|it)\s+(?:duration\s+)?reasonable\b/i,
  },
  {
    intent: "is_reasonable",
    weight: 0.92,
    label: "planner asked about reasonableness",
    pattern: /\b(?:reasonable|realistic|normal)\b/i,
  },
  {
    intent: "evaluate_duration",
    weight: 0.9,
    label: "planner asked to evaluate duration",
    pattern: /\bevaluate\s+(?:the\s+)?duration\b/i,
  },
  {
    intent: "what_changed",
    weight: 0.94,
    label: "planner asked what changed",
    pattern: /\bwhat\s+changed\b/i,
  },
  {
    intent: "explain_change",
    weight: 0.9,
    label: "planner asked why or how something changed",
    pattern: /\bwhy\s+(?:did|was|were|has)\b/i,
  },
  {
    intent: "revision_history",
    weight: 0.92,
    label: "planner asked for revision history",
    pattern: /\b(?:revision history|show (?:me )?(?:the )?timeline|timeline)\b/i,
  },
  {
    intent: "logic_change",
    weight: 0.94,
    label: "planner asked about programme logic",
    pattern: /\b(?:programme logic|logic perspective|from a logic)\b/i,
  },
  {
    intent: "relationship_change",
    weight: 0.9,
    label: "planner asked about relationships",
    pattern: /\brelationships?\b/i,
  },
  {
    intent: "lag_change",
    weight: 0.9,
    label: "planner asked about lag",
    pattern: /\blag\b/i,
  },
  {
    intent: "float_change",
    weight: 0.9,
    label: "planner asked about float",
    pattern: /\bfloat\b/i,
  },
  {
    intent: "explain_criticality",
    weight: 0.94,
    label: "planner asked why something is critical",
    pattern: /\bwhy\s+(?:is|was)\s+(?:it|this)\s+critical\b/i,
  },
  {
    intent: "criticality",
    weight: 0.88,
    label: "planner asked about criticality",
    pattern: /\bcritical(?:ity| path)?\b/i,
  },
  {
    intent: "recommendation",
    weight: 0.9,
    label: "planner asked for a recommendation",
    pattern: /\b(?:what should|recommend|do next|review first)\b/i,
  },
  {
    intent: "lessons",
    weight: 0.92,
    label: "planner asked what usually happens",
    pattern: /\b(?:what usually|usually happens|lessons?\b|historically)\b/i,
  },
  {
    intent: "summary",
    weight: 0.9,
    label: "planner asked for a summary",
    pattern: /\b(?:summar(?:y|ise|ize)|overview|explain everything)\b/i,
  },
  {
    intent: "should_change_duration",
    weight: 0.9,
    label: "planner asked whether to change duration",
    pattern: /\bshould\s+(?:i|we)\s+(?:increase|reduce|change)\b/i,
  },
  {
    intent: "comparison",
    weight: 0.85,
    label: "planner asked for comparison",
    pattern: /\bcompar(?:e|ison|ing)\b/i,
  },
  {
    intent: "risk",
    weight: 0.88,
    label: "planner asked about risk or slips",
    pattern: /\b(?:risk|slips?|worries? you)\b/i,
  },
];

function classifyScope(question: string): {
  scope: PlannerEvidenceScope;
  rationale: string;
  confidence: number;
  comparisonMode: PlannerComparisonMode;
} {
  const matches: Array<ScopeMatch & { pattern: RegExp }> = [];
  for (const entry of SCOPE_REGEX) {
    if (entry.pattern.test(question)) matches.push(entry);
  }

  if (matches.length === 0) {
    return {
      scope: "AUTO",
      rationale: "no explicit evidence scope stated",
      confidence: 0.55,
      comparisonMode: "unspecified",
    };
  }

  matches.sort((a, b) => b.weight - a.weight);

  const evolutionHits = matches.filter((m) => m.scope === "PROJECT_EVOLUTION");
  const previousHits = matches.filter((m) => m.scope === "PREVIOUS_PROJECTS");
  const bothHits = matches.filter((m) => m.scope === "BOTH");

  if (bothHits.length > 0) {
    return {
      scope: "BOTH",
      rationale: bothHits[0]!.label,
      confidence: bothHits[0]!.weight,
      comparisonMode: "both",
    };
  }

  if (evolutionHits.length > 0 && previousHits.length > 0) {
    const evo = evolutionHits[0]!;
    const prev = previousHits[0]!;
    if (evo.weight >= prev.weight) {
      return {
        scope: "PROJECT_EVOLUTION",
        rationale: evo.label,
        confidence: evo.weight,
        comparisonMode: "none",
      };
    }
    return {
      scope: "PREVIOUS_PROJECTS",
      rationale: prev.label,
      confidence: prev.weight,
      comparisonMode: "previous_projects",
    };
  }

  const top = matches[0]!;
  let comparisonMode: PlannerComparisonMode = "unspecified";
  if (top.scope === "PREVIOUS_PROJECTS") comparisonMode = "previous_projects";
  if (top.scope === "PROJECT_EVOLUTION") comparisonMode = "none";
  if (top.scope === "BOTH") comparisonMode = "both";

  return {
    scope: top.scope,
    rationale: top.label,
    confidence: top.weight,
    comparisonMode,
  };
}

function classifyIntent(question: string): {
  intent: PlannerQueryIntent;
  rationale: string;
  confidence: number;
} {
  const matches: IntentMatch[] = [];
  for (const entry of INTENT_REGEX) {
    if (entry.pattern.test(question)) {
      matches.push(entry);
    }
  }

  if (matches.length === 0) {
    return {
      intent: "general",
      rationale: "general planner question",
      confidence: 0.5,
    };
  }

  matches.sort((a, b) => b.weight - a.weight);
  const top = matches[0]!;
  return { intent: top.intent, rationale: top.label, confidence: top.weight };
}

function classifyEntity(
  question: string,
  scope: PlannerEvidenceScope,
  pageContext?: string | null
): PlannerQueryEntity {
  if (scope === "PORTFOLIO") return "portfolio";
  if (/\bportfolio\b/i.test(question)) return "portfolio";
  if (/\bactivity\b/i.test(question)) return "activity";
  if (scope === "PROGRAMME" || /\bprogramme\b/i.test(question)) return "programme";
  if (pageContext === "dashboard" || pageContext === "comparison") return "programme";
  return "deliverable";
}

function classifyTimeframe(question: string): PlannerTimeframe {
  if (/\bbaseline\b/i.test(question)) return "baseline";
  if (/\blatest\b/i.test(question)) return "latest";
  if (/\bbetween\s+update/i.test(question)) return "between_revisions";
  if (/\b(?:full history|all revisions?)\b/i.test(question)) return "full_history";
  return "unspecified";
}

function extractQualifiers(question: string): string[] {
  const qualifiers: string[] = [];
  if (/\bignor(?:ing|e)\s+previous/i.test(question)) qualifiers.push("ignore_previous_projects");
  if (/\bon project evolution level\b/i.test(question)) qualifiers.push("project_evolution_only");
  if (/\bprogramme logic\b/i.test(question)) qualifiers.push("logic_focus");
  if (/\bonly\b/i.test(question)) qualifiers.push("narrow_scope");
  return qualifiers;
}

/**
 * Interprets a planner question into a structured PlannerQuery.
 * Uses weighted phrase classification — not raw keyword→domain routing.
 */
export function interpretPlannerQuery(
  question: string,
  opts?: { pageContext?: string | null }
): PlannerQuery {
  const trimmed = question.trim();
  const scopeResult = classifyScope(trimmed);
  const intentResult = classifyIntent(trimmed);

  const confidence = Math.min(
    0.98,
    Math.round((scopeResult.confidence * 0.55 + intentResult.confidence * 0.45) * 100) / 100
  );

  return {
    intent: intentResult.intent,
    scope: scopeResult.scope,
    entity: classifyEntity(trimmed, scopeResult.scope, opts?.pageContext),
    comparisonMode: scopeResult.comparisonMode,
    timeframe: classifyTimeframe(trimmed),
    qualifiers: extractQualifiers(trimmed),
    confidence,
    scopeRationale: scopeResult.rationale,
    intentRationale: intentResult.rationale,
  };
}
