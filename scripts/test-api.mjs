/**
 * Run with: node scripts/test-api.mjs
 * Server must be running: npm run dev
 * Optionally: API_URL=http://localhost:3000 node scripts/test-api.mjs
 */

const BASE = process.env.API_URL || "http://localhost:3000";

function log(name, ok, detail = "") {
  const icon = ok ? "✓" : "✗";
  console.log(`${icon} ${name}${detail ? " " + detail : ""}`);
}

async function request(method, path, body = null) {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const opts = { method, headers: {} };
  if (body && (method === "POST" || method === "PUT")) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  console.log("\n--- Testing Rana4 API ---\n");
  let failed = 0;

  // Health
  let r = await request("GET", "/health");
  if (!r.ok || r.data?.status !== "ok") {
    log("GET /health", false, r.status + " " + JSON.stringify(r.data));
    failed++;
  } else log("GET /health", true);

  // Standards
  r = await request("POST", "/standards", { name: "Test Standard", description: "For testing" });
  if (!r.ok || !r.data?.id) {
    log("POST /standards", false, r.status + " " + JSON.stringify(r.data));
    failed++;
    process.exit(1);
  }
  const standardId = r.data.id;
  log("POST /standards", true, standardId);

  r = await request("GET", "/standards");
  if (!r.ok || !Array.isArray(r.data) || r.data.length < 1) {
    log("GET /standards", false, r.status);
    failed++;
  } else log("GET /standards", true);

  r = await request("GET", `/standards/${standardId}`);
  if (!r.ok) {
    log("GET /standards/:id", false, r.status);
    failed++;
  } else log("GET /standards/:id", true);

  r = await request("PUT", `/standards/${standardId}`, { name: "Test Standard Updated" });
  if (!r.ok) {
    log("PUT /standards/:id", false, r.status);
    failed++;
  } else log("PUT /standards/:id", true);

  // Assurance notes
  r = await request("POST", "/assurance-notes", { standardId, noteText: "Test note" });
  if (!r.ok || !r.data?.id) {
    log("POST /assurance-notes", false, r.status + " " + JSON.stringify(r.data));
    failed++;
  } else log("POST /assurance-notes", true);
  const noteId = r.data?.id;

  r = await request("GET", `/assurance-notes/standard/${standardId}`);
  if (!r.ok || !Array.isArray(r.data)) {
    log("GET /assurance-notes/standard/:standardId", false, r.status);
    failed++;
  } else log("GET /assurance-notes/standard/:standardId", true);

  // Fragnets
  r = await request("POST", "/fragnets", { standardId, name: "Test Fragnet", description: "Frag" });
  if (!r.ok || !r.data?.id) {
    log("POST /fragnets", false, r.status + " " + JSON.stringify(r.data));
    failed++;
    process.exit(1);
  }
  const fragnetId = r.data.id;
  log("POST /fragnets", true, fragnetId);

  r = await request("GET", `/fragnets/standard/${standardId}`);
  if (!r.ok || !Array.isArray(r.data)) {
    log("GET /fragnets/standard/:standardId", false, r.status);
    failed++;
  } else log("GET /fragnets/standard/:standardId", true);

  r = await request("GET", `/fragnets/${fragnetId}`);
  if (!r.ok) {
    log("GET /fragnets/:id", false, r.status);
    failed++;
  } else log("GET /fragnets/:id", true);

  r = await request("POST", "/deliverables", {
    fragnetId,
    name: "Test Deliverable",
    bestDuration: 1,
    likelyDuration: 1,
  });
  if (!r.ok || !r.data?.id) {
    log("POST /deliverables (for activities)", false, r.status + " " + JSON.stringify(r.data));
    failed++;
    process.exit(1);
  }
  const deliverableId = r.data.id;
  log("POST /deliverables (for activities)", true);

  // Activities
  r = await request("POST", "/activities", {
    fragnetId,
    deliverableId,
    activityCode: "A1",
    name: "Activity One",
    bestDuration: 5,
    likelyDuration: 7,
  });
  if (!r.ok || !r.data?.id) {
    log("POST /activities (1)", false, r.status + " " + JSON.stringify(r.data));
    failed++;
    process.exit(1);
  }
  const activity1Id = r.data.id;
  log("POST /activities (1)", true);

  r = await request("POST", "/activities", {
    fragnetId,
    deliverableId,
    activityCode: "A2",
    name: "Activity Two",
    bestDuration: 3,
    likelyDuration: 4,
  });
  if (!r.ok || !r.data?.id) {
    log("POST /activities (2)", false, r.status + " " + JSON.stringify(r.data));
    failed++;
  } else log("POST /activities (2)", true);
  const activity2Id = r.data?.id;

  r = await request("GET", `/activities/fragnet/${fragnetId}`);
  if (!r.ok || !Array.isArray(r.data)) {
    log("GET /activities/fragnet/:fragnetId", false, r.status);
    failed++;
  } else log("GET /activities/fragnet/:fragnetId", true);

  r = await request("GET", `/activities/${activity1Id}`);
  if (!r.ok) {
    log("GET /activities/:id", false, r.status);
    failed++;
  } else log("GET /activities/:id", true);

  r = await request("POST", "/deliverables", {
    fragnetId,
    name: "Test Deliverable B",
    bestDuration: 1,
    likelyDuration: 1,
  });
  const deliverableBId = r.data?.id;
  if (!r.ok || !deliverableBId) {
    log("POST /deliverables (B for PUT)", false, r.status + " " + JSON.stringify(r.data));
    failed++;
  } else {
    r = await request("PUT", `/activities/${activity1Id}`, { deliverableId: deliverableBId });
    if (!r.ok || r.data?.deliverableId !== deliverableBId) {
      log("PUT /activities/:id (move deliverableId)", false, r.status + " " + JSON.stringify(r.data));
      failed++;
    } else log("PUT /activities/:id (move deliverableId)", true);

    r = await request("PUT", `/activities/${activity1Id}`, { deliverableId: "" });
    if (r.status !== 400) {
      log("PUT /activities/:id (empty deliverableId) → 400", false, "got " + r.status);
      failed++;
    } else log("PUT /activities/:id (empty deliverableId) → 400", true);
  }

  // Relationships
  r = await request("POST", "/relationships", {
    fragnetId,
    predecessorActivityId: activity1Id,
    successorActivityId: activity2Id,
    relationshipType: "FS",
    lag: 0,
  });
  if (!r.ok || !r.data?.id) {
    log("POST /relationships", false, r.status + " " + JSON.stringify(r.data));
    failed++;
  } else log("POST /relationships", true);
  const relationshipId = r.data?.id;

  r = await request("GET", `/relationships/fragnet/${fragnetId}`);
  if (!r.ok || !Array.isArray(r.data)) {
    log("GET /relationships/fragnet/:fragnetId", false, r.status);
    failed++;
  } else log("GET /relationships/fragnet/:fragnetId", true);

  // Duplicate relationship → 400
  r = await request("POST", "/relationships", {
    fragnetId,
    predecessorActivityId: activity1Id,
    successorActivityId: activity2Id,
    relationshipType: "FS",
    lag: 0,
  });
  if (r.status !== 400) {
    log("POST /relationships (duplicate) → 400", false, "got " + r.status);
    failed++;
  } else log("POST /relationships (duplicate) → 400", true);

  // Stress test: A1→A2→A3, delete A2, export must not crash (cascade removes relationships)
  r = await request("POST", "/activities", {
    fragnetId,
    deliverableId,
    activityCode: "A3",
    name: "Activity Three",
    bestDuration: 2,
    likelyDuration: 3,
  });
  if (!r.ok || !r.data?.id) {
    log("POST /activities (A3 for stress test)", false, r.status);
    failed++;
  } else {
    const activity3Id = r.data.id;
    await request("POST", "/relationships", {
      fragnetId,
      predecessorActivityId: activity2Id,
      successorActivityId: activity3Id,
      relationshipType: "FS",
      lag: 0,
    });
    await request("DELETE", `/activities/${activity2Id}`);
    r = await request("GET", `/export/fragnet/${fragnetId}?scenario=best`);
    if (!r.ok || typeof r.data?.taskCsv !== "string") {
      log("Export after deleting middle activity (cascade)", false, r.status);
      failed++;
    } else log("Export after deleting middle activity (cascade)", true);
    await request("DELETE", `/activities/${activity3Id}`);
  }

  // Export
  r = await request("GET", `/export/fragnet/${fragnetId}?scenario=best`);
  if (!r.ok || typeof r.data?.taskCsv !== "string" || typeof r.data?.taskPredCsv !== "string") {
    log("GET /export/fragnet/:fragnetId?scenario=best", false, r.status + " " + (r.data?.error || ""));
    failed++;
  } else log("GET /export/fragnet/:fragnetId?scenario=best", true);

  r = await request("GET", `/export/fragnet/${fragnetId}?scenario=likely`);
  if (!r.ok || typeof r.data?.taskCsv !== "string") {
    log("GET /export/fragnet/:fragnetId?scenario=likely", false, r.status);
    failed++;
  } else log("GET /export/fragnet/:fragnetId?scenario=likely", true);

  // Invalid scenario
  r = await request("GET", `/export/fragnet/${fragnetId}?scenario=invalid`);
  if (r.status !== 400) {
    log("GET /export (invalid scenario) → 400", false, "got " + r.status);
    failed++;
  } else log("GET /export (invalid scenario) → 400", true);

  // 404s
  r = await request("GET", "/standards/00000000-0000-0000-0000-000000000000");
  if (r.status !== 404) {
    log("GET /standards/:id (not found) → 404", false, "got " + r.status);
    failed++;
  } else log("GET /standards/:id (not found) → 404", true);

  // Cleanup (optional)
  if (relationshipId) await request("DELETE", `/relationships/${relationshipId}`);
  if (activity1Id) await request("DELETE", `/activities/${activity1Id}`);
  if (activity2Id) await request("DELETE", `/activities/${activity2Id}`);
  if (fragnetId) await request("DELETE", `/fragnets/${fragnetId}`);
  if (noteId) await request("DELETE", `/assurance-notes/${noteId}`);
  if (standardId) await request("DELETE", `/standards/${standardId}`);
  log("Cleanup (DELETE)", true);

  console.log("\n--- Done ---");
  if (failed > 0) {
    console.log(`Failed: ${failed}`);
    process.exit(1);
  }
  console.log("All checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
