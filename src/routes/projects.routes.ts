import { Router } from "express";
import * as projectsController from "../controllers/projects.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();

router.use(requireAuth);
router.get("/", projectsController.listMyProjects);
router.post("/", projectsController.createProject);
router.put("/:id", projectsController.updateProject);
router.delete("/:id", projectsController.deleteProject);
router.get("/:id/members", projectsController.listMembers);
router.post("/:id/members", projectsController.addMember);
router.patch("/:id/members/:userId", projectsController.updateMemberRole);
router.delete("/:id/members/:userId", projectsController.removeMember);

export default router;

