import { Router } from "express";
import * as invitationsController from "../controllers/invitations.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();

router.use(requireAuth);
router.post("/", invitationsController.invite);

export default router;

