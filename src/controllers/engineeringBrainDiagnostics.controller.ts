import type { Response } from "express";
import type { AuthRequest } from "../middleware/auth.middleware.js";
import { getEngineeringBrainDiagnostics } from "../services/intelligence/diagnostics/engineeringBrainDiagnostics.service.js";
import {
  recordEngineeringReviewDecision,
  isEngineeringKnowledgeStoreAvailable,
  type EngineeringReviewAction,
} from "../services/intelligence/diagnostics/engineeringKnowledgeStore.service.js";
import {
  approveRuleProposal,
  rejectRuleProposal,
} from "../services/intelligence/diagnostics/engineeringRuleProposal.service.js";

const ACTION_MAP: Record<string, EngineeringReviewAction> = {
  approve: "APPROVE",
  modify: "MODIFY",
  reject: "REJECT",
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * GET /dev/engineering-brain
 *
 * Developer-only Engineering Brain maturity & diagnostics report. Gated by
 * requireDevEmail at the router level; never reachable by planners. Read-only,
 * tenant-scoped to the developer's own company.
 */
export async function getEngineeringBrainDashboard(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const report = await getEngineeringBrainDiagnostics({ companyId: req.user.companyId });
    res.json(report);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to load Engineering Brain diagnostics",
    });
  }
}

/**
 * POST /dev/engineering-brain/review
 *
 * Record a developer review decision (approve / modify / reject) for one
 * Engineering Identity fingerprint. Developer-only. This is the only mutation:
 * auto-trusted identities never pass through here.
 */
export async function reviewEngineeringIdentity(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const fingerprint = str(body.fingerprint);
    const actionKey = str(body.action)?.toLowerCase() ?? "";
    const action = ACTION_MAP[actionKey];
    if (!fingerprint) {
      res.status(400).json({ error: "fingerprint is required" });
      return;
    }
    if (!action) {
      res.status(400).json({ error: "action must be one of approve, modify, reject" });
      return;
    }
    if (!isEngineeringKnowledgeStoreAvailable()) {
      res.status(503).json({ error: "Engineering knowledge store is unavailable (migration not applied)" });
      return;
    }

    const rawIdentity = (body.identity ?? {}) as Record<string, unknown>;
    const rawObserved = (body.observed ?? {}) as Record<string, unknown>;
    const entry = await recordEngineeringReviewDecision({
      companyId: req.user.companyId,
      fingerprint,
      action,
      concept: str(body.concept) ?? "",
      identity: {
        discipline: str(rawIdentity.discipline),
        engineeringObject: str(rawIdentity.engineeringObject),
        engineeringWork: str(rawIdentity.engineeringWork),
        deliverableType: str(rawIdentity.deliverableType),
        lifecycleStage: str(rawIdentity.lifecycleStage),
      },
      aliases: Array.isArray(body.aliases)
        ? (body.aliases as unknown[]).filter((a): a is string => typeof a === "string")
        : undefined,
      evidence: Array.isArray(body.evidence)
        ? (body.evidence as unknown[]).filter((e): e is string => typeof e === "string")
        : undefined,
      notes: str(body.notes),
      reviewedBy: req.user.email,
      observed: {
        projectCount: typeof rawObserved.projectCount === "number" ? rawObserved.projectCount : undefined,
        successfulComparisons:
          typeof rawObserved.successfulComparisons === "number" ? rawObserved.successfulComparisons : undefined,
      },
    });

    if (!entry) {
      res.status(503).json({ error: "Failed to persist review decision" });
      return;
    }
    res.json({ entry });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to record review decision",
    });
  }
}

/**
 * POST /dev/engineering-brain/rule-proposals/:id/approve
 *
 * Approve a PENDING rule proposal (spec section 6, Phase 3): creates the
 * corresponding EngineeringLearnedRule row and marks the proposal APPROVED.
 * Developer-only, tenant-scoped — the proposal is looked up by (id, companyId)
 * together, same posture as every other Engineering Brain mutation.
 */
export async function approveRuleProposalHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const proposalId = str(req.params.id);
    if (!proposalId) {
      res.status(400).json({ error: "proposal id is required" });
      return;
    }
    const result = await approveRuleProposal({
      companyId: req.user.companyId,
      proposalId,
      reviewedBy: req.user.email,
    });
    if (!result.ok) {
      res.status(result.error === "Proposal not found" ? 404 : 503).json({ error: result.error });
      return;
    }
    res.json({ proposal: result.proposal });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to approve rule proposal",
    });
  }
}

/**
 * POST /dev/engineering-brain/rule-proposals/:id/reject
 *
 * Reject a PENDING rule proposal (spec section 6, Phase 3): marks REJECTED
 * with optional notes so the same evidence cluster never resurfaces an
 * identical proposal on a later diagnostics run.
 */
export async function rejectRuleProposalHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const proposalId = str(req.params.id);
    if (!proposalId) {
      res.status(400).json({ error: "proposal id is required" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await rejectRuleProposal({
      companyId: req.user.companyId,
      proposalId,
      reviewedBy: req.user.email,
      notes: str(body.notes),
    });
    if (!result.ok) {
      res.status(result.error === "Proposal not found" ? 404 : 503).json({ error: result.error });
      return;
    }
    res.json({ proposal: result.proposal });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to reject rule proposal",
    });
  }
}
