/**
 * Deterministic validation for an Engineering Identity.
 *
 * The reasoning layer (rule-based or LLM) proposes an identity; this module is
 * the deterministic gate that rejects internally contradictory identities
 * BEFORE any historical comparison runs. It never invents data and never calls
 * an LLM — it only checks that the resolved components are mutually consistent.
 *
 * Rule-based identities are consistent by construction, so validation is inert
 * for them. It becomes meaningful for LLM-reasoned identities, where a model
 * could otherwise emit "Fire Technical Note with a Mechanical discipline" or
 * name a document type (General Arrangement, Report) as the engineering object.
 */
import {
  ENGINEERING_OBJECT_RULES,
  DISCIPLINE_OBJECT_FALLBACKS,
  WORK_PACKAGE_OBJECT_FALLBACKS,
} from "./engineeringVocabulary.data.js";
import { DOCUMENT_TYPE_RULES } from "./documentType.extraction.js";
import type {
  EngineeringIdentity,
  EngineeringIdentityComponent,
} from "./engineeringIdentity.service.js";

export type EngineeringIdentityValidationRule =
  | "OBJECT_MUST_BE_PHYSICAL"
  | "OBJECT_DISCIPLINE_INCOMPATIBLE"
  | "WORK_TYPE_INCOMPATIBLE"
  | "OBJECT_MUTUALLY_EXCLUSIVE";

export type EngineeringIdentityContradiction = {
  rule: EngineeringIdentityValidationRule;
  components: Array<
    | "DISCIPLINE"
    | "ENGINEERING_OBJECT"
    | "ENGINEERING_WORK"
    | "DELIVERABLE_TYPE"
  >;
  detail: string;
};

export type EngineeringIdentityValidation = {
  valid: boolean;
  contradictions: EngineeringIdentityContradiction[];
};

/**
 * Document / output ids that describe the *form* of a deliverable, never the
 * physical engineering asset. If any of these lands in `engineeringObject`,
 * reasoning has confused an output for an object.
 */
const DOCUMENT_OUTPUT_IDS = new Set<string>([
  ...DOCUMENT_TYPE_RULES.map((rule) => rule.id),
  "drawing",
  "drawing_pack",
  "report",
  "technical_note",
  "general_arrangement",
  "elevation",
  "analysis",
  "scope",
  "package",
]);

/** Valid engineering-object ids the reasoning layer is allowed to emit. */
const KNOWN_OBJECT_IDS = new Set<string>([
  ...ENGINEERING_OBJECT_RULES.map((rule) => rule.id),
  ...Object.values(DISCIPLINE_OBJECT_FALLBACKS).map((fallback) => fallback.id),
  ...Object.values(WORK_PACKAGE_OBJECT_FALLBACKS).map((fallback) => fallback.id),
]);

/** Discipline restriction per engineering object, sourced from the vocabulary. */
const OBJECT_DISCIPLINE_RESTRICTIONS: Record<string, string[]> = (() => {
  const map: Record<string, string[]> = {};
  for (const rule of ENGINEERING_OBJECT_RULES) {
    if (rule.disciplines?.length) map[rule.id] = rule.disciplines;
  }
  // Discipline fallbacks are, by definition, tied to their own discipline.
  for (const [discipline, fallback] of Object.entries(DISCIPLINE_OBJECT_FALLBACKS)) {
    map[fallback.id] = map[fallback.id] ?? [discipline];
  }
  return map;
})();

/**
 * Engineering-work ids that cannot be reconciled with a given deliverable-type
 * id. A General Arrangement drawing is not a Report; a Meeting is not a Model.
 */
const WORK_TYPE_INCOMPATIBILITIES: Array<{ work: string; types: string[]; detail: string }> = [
  {
    work: "general_arrangement",
    types: ["report", "technical_note", "schedule", "specification"],
    detail: "General Arrangement work cannot also be a narrative document type",
  },
  {
    work: "meeting",
    types: ["model", "drawing", "design_drawing", "general_arrangement"],
    detail: "Meeting work cannot produce a drawing or model deliverable type",
  },
  {
    work: "milestone",
    types: ["model", "drawing", "design_drawing", "report", "technical_note"],
    detail: "Milestone work cannot produce a drawing, model or report deliverable type",
  },
];

function id(component: EngineeringIdentityComponent | undefined): string | null {
  return component?.id ?? null;
}

export function validateEngineeringIdentity(
  identity: EngineeringIdentity
): EngineeringIdentityValidation {
  const contradictions: EngineeringIdentityContradiction[] = [];
  const objectId = id(identity.engineeringObject);
  const disciplineId = id(identity.discipline);
  const workId = id(identity.engineeringWork);
  const typeId = id(identity.deliverableType);

  // 1. The engineering object must be a physical asset / system, not an output.
  if (objectId && DOCUMENT_OUTPUT_IDS.has(objectId)) {
    contradictions.push({
      rule: "OBJECT_MUST_BE_PHYSICAL",
      components: ["ENGINEERING_OBJECT"],
      detail: `"${objectId}" is a document/output type, not an engineering object`,
    });
  } else if (objectId && !KNOWN_OBJECT_IDS.has(objectId)) {
    // Unknown object id → reasoning invented a value outside the vocabulary.
    contradictions.push({
      rule: "OBJECT_MUTUALLY_EXCLUSIVE",
      components: ["ENGINEERING_OBJECT"],
      detail: `"${objectId}" is not a recognised engineering object`,
    });
  }

  // 2. The object cannot belong to a discipline that contradicts the resolved
  //    discipline (e.g. a Fire Safety object with a Mechanical discipline).
  if (objectId && disciplineId) {
    const allowed = OBJECT_DISCIPLINE_RESTRICTIONS[objectId];
    if (allowed && !allowed.includes(disciplineId)) {
      contradictions.push({
        rule: "OBJECT_DISCIPLINE_INCOMPATIBLE",
        components: ["DISCIPLINE", "ENGINEERING_OBJECT"],
        detail: `object "${objectId}" is only valid for discipline(s) ${allowed.join(", ")}, not "${disciplineId}"`,
      });
    }
  }

  // 3. Engineering work and deliverable type must be reconcilable.
  if (workId && typeId) {
    const rule = WORK_TYPE_INCOMPATIBILITIES.find(
      (candidate) => candidate.work === workId && candidate.types.includes(typeId)
    );
    if (rule) {
      contradictions.push({
        rule: "WORK_TYPE_INCOMPATIBLE",
        components: ["ENGINEERING_WORK", "DELIVERABLE_TYPE"],
        detail: `${rule.detail} (work "${workId}" vs type "${typeId}")`,
      });
    }
  }

  return { valid: contradictions.length === 0, contradictions };
}

/**
 * Fail-closed enforcement. If a contradiction touches an IDENTITY component
 * (discipline / object / work), that component is cleared so the deterministic
 * comparator can never treat the identity as equivalent to another. The
 * identity is downgraded to INSUFFICIENT and the validation record is attached
 * for diagnostics.
 */
export function enforceEngineeringIdentityValidation<T extends EngineeringIdentity>(
  identity: T
): T & { validation: EngineeringIdentityValidation } {
  const validation = validateEngineeringIdentity(identity);
  if (validation.valid) {
    return { ...identity, validation };
  }

  const cleared = new Set(validation.contradictions.flatMap((c) => c.components));
  const clear = (component: EngineeringIdentityComponent): EngineeringIdentityComponent =>
    ({ id: null, label: null, evidence: component.evidence });

  const next: T & { validation: EngineeringIdentityValidation } = {
    ...identity,
    discipline: cleared.has("DISCIPLINE") ? clear(identity.discipline) : identity.discipline,
    engineeringObject: cleared.has("ENGINEERING_OBJECT")
      ? clear(identity.engineeringObject)
      : identity.engineeringObject,
    engineeringWork: cleared.has("ENGINEERING_WORK")
      ? clear(identity.engineeringWork)
      : identity.engineeringWork,
    deliverableType: cleared.has("DELIVERABLE_TYPE")
      ? clear(identity.deliverableType)
      : identity.deliverableType,
    status: "INSUFFICIENT",
    validation,
  };
  return next;
}
