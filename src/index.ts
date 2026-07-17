import "dotenv/config";
import { installConsoleRedaction } from "./services/security/logging.js";
import { validateRuntimeSecurityConfig } from "./services/security/runtimeConfig.js";
import { runSecuritySelfTests } from "./services/security/selfTests.js";

installConsoleRedaction();
const runtimeConfig = validateRuntimeSecurityConfig();
const isProduction = runtimeConfig.isProduction;

import cors from "cors";
import express from "express";
import swaggerUi from "swagger-ui-express";
import activityCodeTypesRoutes from "./routes/activityCodeTypes.routes.js";
import activityCodesRoutes from "./routes/activityCodes.routes.js";
import activitiesRoutes from "./routes/activities.routes.js";
import assuranceNotesRoutes from "./routes/assuranceNotes.routes.js";
import authRoutes from "./routes/auth.routes.js";
import deliverablesRoutes from "./routes/deliverables.routes.js";
import exportRoutes from "./routes/export.routes.js";
import importRoutes from "./routes/import.routes.js";
import intelligenceRoutes from "./routes/intelligence.routes.js";
import fragnetsRoutes from "./routes/fragnets.routes.js";
import healthRoutes from "./routes/healthRoutes.js";
import { openApiSpec } from "./api/openapi.js";
import rateCardRoutes from "./routes/rateCard.routes.js";
import relationshipsRoutes from "./routes/relationships.routes.js";
import deliverableRelationshipsRoutes from "./routes/deliverableRelationships.routes.js";
import deliverableActivityRelationshipsRoutes from "./routes/deliverableActivityRelationships.routes.js";
import activityToDeliverableRelationshipsRoutes from "./routes/activityToDeliverableRelationships.routes.js";
import standardsRoutes from "./routes/standards.routes.js";
import invitationsRoutes from "./routes/invitations.routes.js";
import projectsRoutes from "./routes/projects.routes.js";
import auditLogsRoutes from "./routes/auditLogs.routes.js";
import secureApprovalsRoutes from "./routes/secureApprovals.routes.js";
import companyRoutes from "./routes/company.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import devRoutes from "./routes/dev.routes.js";
import debugRoutes from "./routes/debug.routes.js";
import { requestCorrelation } from "./middleware/requestCorrelation.middleware.js";
import { productionSecurityMiddleware } from "./middleware/security/securityHeaders.middleware.js";
import { connectPrisma } from "./utils/prisma.js";

const app = express();
const basePort = runtimeConfig.port;
const maxPortAttempts = 10;

app.use(
  cors({
    origin: runtimeConfig.corsOrigins.length > 0 ? runtimeConfig.corsOrigins : !runtimeConfig.isProduction,
    credentials: true,
  })
);
app.use(requestCorrelation);
app.use(productionSecurityMiddleware);
app.use(express.json({ limit: "1mb" }));

if (!runtimeConfig.isProduction) {
  // Swagger UI needs inline scripts/styles from swagger-ui-express. Keep this
  // development-only so the global production CSP remains strict everywhere.
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));
}

app.get("/", (_req, res) => {
  res.redirect(302, "/health");
});

app.use("/health", healthRoutes);
app.use("/rate-card", rateCardRoutes);
app.use("/auth", authRoutes);
app.use("/company", companyRoutes);
app.use("/admin", adminRoutes);
app.use("/dev", devRoutes);
app.use("/api/debug", debugRoutes);
app.use("/invite", invitationsRoutes);
app.use("/projects", projectsRoutes);
app.use("/audit-logs", auditLogsRoutes);
app.use("/secure-approvals", secureApprovalsRoutes);
app.use("/export", exportRoutes);
app.use("/import", importRoutes);
app.use("/intelligence", intelligenceRoutes);
app.use("/standards", standardsRoutes);
app.use("/deliverables", deliverablesRoutes);
app.use("/activities", activitiesRoutes);
app.use("/activity-code-types", activityCodeTypesRoutes);
app.use("/activity-codes", activityCodesRoutes);
app.use("/assurance-notes", assuranceNotesRoutes);
app.use("/fragnets", fragnetsRoutes);
app.use("/relationships", relationshipsRoutes);
app.use("/deliverable-relationships", deliverableRelationshipsRoutes);
app.use("/deliverable-activity-relationships", deliverableActivityRelationshipsRoutes);
app.use("/activity-to-deliverable-relationships", activityToDeliverableRelationshipsRoutes);

function listenWithFallback(startPort: number) {
  let attempt = 0;

  const tryListen = (port: number) => {
    const server = app.listen(port, () => {
      if (!isProduction) {
        console.log(`Server listening on http://localhost:${port}`);
      }
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE" && attempt < maxPortAttempts - 1) {
        attempt += 1;
        const nextPort = startPort + attempt;
        if (!isProduction) {
          console.warn(`Port ${port} is in use, trying ${nextPort}...`);
        }
        tryListen(nextPort);
        return;
      }

      console.error(err);
      process.exit(1);
    });
  };

  tryListen(startPort);
}

runSecuritySelfTests()
  .then(() => connectPrisma())
  .then(() => listenWithFallback(basePort))
  .catch((err) => {
    console.error(
      err instanceof Error && err.message.includes("connect")
        ? "Could not connect to the database. Check DATABASE_URL in .env and that Neon/PostgreSQL is reachable."
        : err
    );
    process.exit(1);
  });
