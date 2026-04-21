import "dotenv/config";

const isProduction = process.env.NODE_ENV === "production";
if (isProduction && (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim().length < 32)) {
  console.error("Production requires JWT_SECRET to be set and at least 32 characters.");
  process.exit(1);
}

import cors from "cors";
import express from "express";
import swaggerUi from "swagger-ui-express";
import activitiesRoutes from "./routes/activities.routes.js";
import assuranceNotesRoutes from "./routes/assuranceNotes.routes.js";
import authRoutes from "./routes/auth.routes.js";
import deliverablesRoutes from "./routes/deliverables.routes.js";
import exportRoutes from "./routes/export.routes.js";
import fragnetsRoutes from "./routes/fragnets.routes.js";
import healthRoutes from "./routes/healthRoutes.js";
import { openApiSpec } from "./openapi.js";
import rateCardRoutes from "./routes/rateCard.routes.js";
import relationshipsRoutes from "./routes/relationships.routes.js";
import standardsRoutes from "./routes/standards.routes.js";
import invitationsRoutes from "./routes/invitations.routes.js";
import projectsRoutes from "./routes/projects.routes.js";
import auditLogsRoutes from "./routes/auditLogs.routes.js";
import companyRoutes from "./routes/company.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import devRoutes from "./routes/dev.routes.js";
import "./utils/prisma.js";

const app = express();
const port = Number(process.env.PORT) || 3000;

const corsOrigins = process.env.CORS_ORIGIN?.split(",").map((s) => s.trim()).filter(Boolean);
app.use(
  cors({
    origin: corsOrigins && corsOrigins.length > 0 ? corsOrigins : true,
    credentials: true,
  })
);
app.use(express.json());

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));

app.get("/", (_req, res) => {
  res.redirect(302, "/health");
});

app.use("/health", healthRoutes);
app.use("/rate-card", rateCardRoutes);
app.use("/auth", authRoutes);
app.use("/company", companyRoutes);
app.use("/admin", adminRoutes);
app.use("/dev", devRoutes);
app.use("/invite", invitationsRoutes);
app.use("/projects", projectsRoutes);
app.use("/audit-logs", auditLogsRoutes);
app.use("/export", exportRoutes);
app.use("/standards", standardsRoutes);
app.use("/deliverables", deliverablesRoutes);
app.use("/activities", activitiesRoutes);
app.use("/assurance-notes", assuranceNotesRoutes);
app.use("/fragnets", fragnetsRoutes);
app.use("/relationships", relationshipsRoutes);

app.listen(port, () => {
  if (!isProduction) {
    console.log(`Server listening on http://localhost:${port}`);
  }
});
