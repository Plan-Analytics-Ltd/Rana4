import { Router } from "express";
import multer from "multer";
import * as projectsController from "../controllers/projects.controller.js";
import * as scheduleController from "../controllers/schedule.controller.js";
import * as importController from "../controllers/import.controller.js";
import * as programmeIntelligenceController from "../controllers/programmeIntelligence.controller.js";
import * as projectIntelligenceController from "../controllers/projectIntelligence.controller.js";
import * as explanationController from "../controllers/explanation.controller.js";
import * as askRanaController from "../controllers/askRana.controller.js";
import * as xerProjectImportController from "../controllers/xerProjectImport.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

router.use(requireAuth);
router.get("/", projectsController.listMyProjects);
router.post("/", projectsController.createProject);
router.post("/from-xer/preview", upload.single("file"), xerProjectImportController.previewXerProject);
router.post("/from-xer", upload.single("file"), xerProjectImportController.createProjectFromXer);
router.put("/:id", projectsController.updateProject);
router.delete("/:id", projectsController.deleteProject);
router.post("/:projectId/import", upload.single("file"), importController.importProjectTemplate);
router.post(
  "/:projectId/programme-import",
  upload.single("file"),
  programmeIntelligenceController.importProgramme
);
router.get("/:projectId/programme-snapshots", programmeIntelligenceController.listSnapshots);
router.get("/:projectId/programme-revisions", programmeIntelligenceController.listProgrammeRevisions);
router.get(
  "/:projectId/programme-revisions/live/deliverable-durations",
  programmeIntelligenceController.getLiveDeliverableDurationsHandler
);
router.get(
  "/:projectId/programme-revisions/:snapshotId/deliverable-durations",
  programmeIntelligenceController.getRevisionDeliverableDurationsHandler
);
router.post(
  "/:projectId/programme-snapshots/baseline",
  programmeIntelligenceController.createBaselineSnapshot
);
router.get("/:projectId/planned-vs-actual", programmeIntelligenceController.getPlannedVsActual);
router.get("/:projectId/intelligence-profile", programmeIntelligenceController.getIntelligenceProfile);
router.put("/:projectId/intelligence-profile", programmeIntelligenceController.updateIntelligenceProfile);
// Programme Intelligence Foundation (v2 canonical endpoints)
router.get("/:projectId/intelligence/profile", projectIntelligenceController.getIntelligenceProfile);
router.put("/:projectId/intelligence/profile", projectIntelligenceController.putIntelligenceProfile);
router.get("/:projectId/intelligence/similar-projects", projectIntelligenceController.getSimilarProjectsForProject);
router.get(
  "/:projectId/intelligence/programme-review",
  projectIntelligenceController.getProgrammeReview
);
router.get(
  "/:projectId/project-intelligence",
  projectIntelligenceController.getProjectIntelligenceForProject
);
router.get(
  "/:projectId/intelligence/similar-deliverables/:deliverableId",
  projectIntelligenceController.getSimilarDeliverablesForDeliverable
);
router.get(
  "/:projectId/intelligence/project-evolution/:deliverableId",
  projectIntelligenceController.getDeliverableProjectEvolutionForDeliverable
);
router.get(
  "/:projectId/intelligence/analysis/:deliverableId",
  projectIntelligenceController.getDeliverableIntelligenceAnalysisForDeliverable
);
router.get(
  "/:projectId/intelligence/benchmark/:deliverableId",
  projectIntelligenceController.getDeliverableBenchmarkForDeliverable
);
router.get(
  "/:projectId/intelligence/findings/:deliverableId",
  projectIntelligenceController.getDeliverableFindingsForDeliverable
);
router.get(
  "/:projectId/intelligence/drivers/:deliverableId",
  projectIntelligenceController.getDeliverableDriversForDeliverable
);
router.get(
  "/:projectId/intelligence/recommendations/:deliverableId",
  projectIntelligenceController.getDeliverableRecommendationsForDeliverable
);
router.get(
  "/:projectId/intelligence/trust/:deliverableId",
  projectIntelligenceController.getDeliverableTrustForDeliverable
);
router.post("/:projectId/intelligence/explain/validate", explanationController.postValidateDeliverableExplanation);
router.post("/:projectId/intelligence/explain", explanationController.postDeliverableExplanation);
router.post("/:projectId/intelligence/ask-rana", askRanaController.postAskRana);
router.get("/:projectId/programme-export", programmeIntelligenceController.exportProgrammeJson);
router.get("/:id/dashboard-summary", projectsController.getDashboardSummary);
router.get("/:id/full-data", projectsController.getFullData);
router.get("/:id/suggested-activity-code", projectsController.getSuggestedActivityCode);
router.get("/:id/activity-code-availability", projectsController.getActivityCodeAvailability);
router.post("/:id/recalculate-schedule", scheduleController.recalculateSchedule);
router.get("/:id/schedule-network", scheduleController.getScheduleNetwork);
router.get("/:id/critical-path", scheduleController.getCriticalPath);
router.get("/:id/members", projectsController.listMembers);
router.post("/:id/members", projectsController.addMember);
router.patch("/:id/members/:userId", projectsController.updateMemberRole);
router.delete("/:id/members/:userId", projectsController.removeMember);

export default router;

