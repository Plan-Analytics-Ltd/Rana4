import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireDevEmail } from "../middleware/dev.middleware.js";
import * as devController from "../controllers/dev.controller.js";
import * as engineeringBrainDiagnosticsController from "../controllers/engineeringBrainDiagnostics.controller.js";

const router = Router();

router.use(requireAuth, requireDevEmail);

router.get("/engineering-brain", engineeringBrainDiagnosticsController.getEngineeringBrainDashboard);
router.post("/engineering-brain/review", engineeringBrainDiagnosticsController.reviewEngineeringIdentity);
router.post(
  "/engineering-brain/rule-proposals/:id/approve",
  engineeringBrainDiagnosticsController.approveRuleProposalHandler
);
router.post(
  "/engineering-brain/rule-proposals/:id/reject",
  engineeringBrainDiagnosticsController.rejectRuleProposalHandler
);
router.get("/admin-requests", devController.listAdminRequests);
router.post("/admin-requests/:id/approve", devController.approveAdminRequest);
router.post("/admin-requests/:id/reject", devController.rejectAdminRequest);
router.get("/companies", devController.listCompanies);
router.get("/users", devController.listUsers);
router.post("/users/:id/demote", devController.demoteUserFromCompanyAdmin);
router.post("/users/:id/set-role", devController.setUserRole);

export default router;
