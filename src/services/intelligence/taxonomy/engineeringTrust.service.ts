/**
 * Engineering Brain trust model — DEVELOPER ONLY.
 *
 * Every RESOLVED Engineering Identity is self-assessed into exactly one state:
 *
 *   TRUSTED       → auto-approved, participates in comparison immediately
 *   NEEDS_REVIEW  → developer queue (genuine uncertainty)
 *   CONTRADICTORY → developer queue (self-contradiction)
 *
 * This mirrors an experienced engineer: work autonomously, ask for help only
 * when genuinely uncertain. The classification is deterministic — no LLM, no
 * persistence — so "most identities auto-trust" needs zero storage. Only the
 * rare developer decisions are persisted elsewhere.
 */
import { createHash } from "node:crypto";
import type { EngineeringIdentity } from "./engineeringIdentity.service.js";
import type { EngineeringIdentityValidation } from "./engineeringIdentityValidation.service.js";

export type EngineeringTrustState = "TRUSTED" | "NEEDS_REVIEW" | "CONTRADICTORY";

export type TrustedKnowledgeStatus =
  | "AUTO_APPROVED"
  | "DEVELOPER_APPROVED"
  | "DEVELOPER_MODIFIED"
  | "REJECTED";

export type EngineeringTrustReason =
  | "UNKNOWN_ENGINEERING_OBJECT"
  | "UNKNOWN_ENGINEERING_WORK"
  | "CONTRADICTORY_IDENTITY"
  | "MULTIPLE_INTERPRETATIONS"
  | "INSUFFICIENT_EVIDENCE"
  | "VALIDATION_CONFLICT"
  | "REASONING_DISAGREEMENT";

export type EngineeringTrustSignal = {
  /** False when the same concept has resolved to different objects historically. */
  historicallyConsistent?: boolean;
  /** True when multiple interpretations scored comparably. */
  ambiguous?: boolean;
};

export type EngineeringTrustAssessment = {
  state: EngineeringTrustState;
  reasons: EngineeringTrustReason[];
  evidenceSufficient: boolean;
  confidence: number;
};

function coreEvidenced(identity: EngineeringIdentity): boolean {
  return [identity.discipline, identity.engineeringObject, identity.engineeringWork].every(
    (component) => component.evidence.length > 0
  );
}

/**
 * Self-assessment. An identity earns TRUSTED only when it is complete,
 * validation succeeds, no contradiction exists, evidence is sufficient, and it
 * is historically consistent. Anything short of that asks for help.
 */
export function assessEngineeringTrust(args: {
  identity: EngineeringIdentity;
  validation: EngineeringIdentityValidation;
  signal?: EngineeringTrustSignal;
}): EngineeringTrustAssessment {
  const { identity, validation, signal } = args;
  const reasons = new Set<EngineeringTrustReason>();

  if (!validation.valid) {
    reasons.add("CONTRADICTORY_IDENTITY");
    reasons.add("VALIDATION_CONFLICT");
  }
  if (!identity.engineeringObject.id) reasons.add("UNKNOWN_ENGINEERING_OBJECT");
  if (!identity.engineeringWork.id) reasons.add("UNKNOWN_ENGINEERING_WORK");

  const evidenceSufficient =
    identity.status === "RESOLVED" && coreEvidenced(identity) && identity.supportingEvidence.length >= 3;
  if (identity.status === "RESOLVED" && !evidenceSufficient) reasons.add("INSUFFICIENT_EVIDENCE");
  if (signal?.ambiguous) reasons.add("MULTIPLE_INTERPRETATIONS");
  if (signal?.historicallyConsistent === false) reasons.add("REASONING_DISAGREEMENT");

  const state: EngineeringTrustState = !validation.valid
    ? "CONTRADICTORY"
    : identity.status !== "RESOLVED" || reasons.size > 0
      ? "NEEDS_REVIEW"
      : "TRUSTED";

  const resolvedCore = [identity.discipline, identity.engineeringObject, identity.engineeringWork].filter(
    (component) => component.id
  ).length;
  const confidence =
    state === "TRUSTED"
      ? Math.min(98, 80 + identity.supportingEvidence.length * 3)
      : state === "CONTRADICTORY"
        ? 10
        : 25 + resolvedCore * 15;

  return { state, reasons: [...reasons], evidenceSufficient, confidence };
}

/**
 * Stable identity fingerprint used to attach persisted developer decisions.
 * Keyed on the concept subject plus the brain's originally-resolved signature,
 * so a correction applied to one occurrence is remembered for identical future
 * reasoning (including future unknowns that resolve the same way).
 */
export function engineeringIdentityFingerprint(
  subjectKey: string,
  identity: EngineeringIdentity
): string {
  const signature = [
    identity.discipline.id ?? "?",
    identity.engineeringObject.id ?? "?",
    identity.engineeringWork.id ?? "?",
  ].join("|");
  const raw = `${subjectKey.trim().toLowerCase()}::${signature}`;
  return createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 24);
}
