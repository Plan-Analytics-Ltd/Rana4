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
import activitiesRoutes from "./routes/activities.routes.js";
import assuranceNotesRoutes from "./routes/assuranceNotes.routes.js";
import authRoutes from "./routes/auth.routes.js";
import deliverablesRoutes from "./routes/deliverables.routes.js";
import exportRoutes from "./routes/export.routes.js";
import importRoutes from "./routes/import.routes.js";
import fragnetsRoutes from "./routes/fragnets.routes.js";
import healthRoutes from "./routes/healthRoutes.js";
import { openApiSpec } from "./openapi.js";
import rateCardRoutes from "./routes/rateCard.routes.js";
import relationshipsRoutes from "./routes/relationships.routes.js";
import standardsRoutes from "./routes/standards.routes.js";
import invitationsRoutes from "./routes/invitations.routes.js";
import projectsRoutes from "./routes/projects.routes.js";
import auditLogsRoutes from "./routes/auditLogs.routes.js";
import secureApprovalsRoutes from "./routes/secureApprovals.routes.js";
import companyRoutes from "./routes/company.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import devRoutes from "./routes/dev.routes.js";
import { requestCorrelation } from "./middleware/requestCorrelation.middleware.js";
import { productionSecurityMiddleware } from "./middleware/security/securityHeaders.middleware.js";
import "./utils/prisma.js";

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
app.use("/secure-approvals", secureApprovalsRoutes);
app.use("/export", exportRoutes);
app.use("/import", importRoutes);
app.use("/standards", standardsRoutes);
app.use("/deliverables", deliverablesRoutes);
app.use("/activities", activitiesRoutes);
app.use("/assurance-notes", assuranceNotesRoutes);
app.use("/fragnets", fragnetsRoutes);
app.use("/relationships", relationshipsRoutes);

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
  .then(() => listenWithFallback(basePort))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
