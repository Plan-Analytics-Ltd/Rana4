import { Router } from "express";
import multer from "multer";
import * as projectsController from "../controllers/projects.controller.js";
import * as importController from "../controllers/import.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

router.use(requireAuth);
router.get("/", projectsController.listMyProjects);
router.post("/", projectsController.createProject);
router.put("/:id", projectsController.updateProject);
router.delete("/:id", projectsController.deleteProject);
router.post("/:projectId/import", upload.single("file"), importController.importProjectTemplate);
router.get("/:id/full-data", projectsController.getFullData);
router.get("/:id/members", projectsController.listMembers);
router.post("/:id/members", projectsController.addMember);
router.patch("/:id/members/:userId", projectsController.updateMemberRole);
router.delete("/:id/members/:userId", projectsController.removeMember);

export default router;

