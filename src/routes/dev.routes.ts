import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireDevEmail } from "../middleware/dev.middleware.js";
import * as devController from "../controllers/dev.controller.js";

const router = Router();

router.use(requireAuth, requireDevEmail);

router.get("/admin-requests", devController.listAdminRequests);
router.post("/admin-requests/:id/approve", devController.approveAdminRequest);
router.post("/admin-requests/:id/reject", devController.rejectAdminRequest);
router.get("/companies", devController.listCompanies);
router.get("/users", devController.listUsers);
router.post("/users/:id/demote", devController.demoteUserFromCompanyAdmin);
router.post("/users/:id/set-role", devController.setUserRole);

export default router;
