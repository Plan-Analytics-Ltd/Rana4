/**
 * Integration tests for safe project member role demotion.
 *
 * Run:
 *   npm run build && node --test scripts/project-member-demotion.test.mjs
 *
 * Requires:
 * - API running (npm run dev)
 * - DATABASE_URL configured
 */
import test from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.API_URL || "http://localhost:3000";

async function request(method, path, token, body) {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data };
}

async function registerCompanyAdmin(companyName) {
  const email = `demote-admin-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  const r = await request("POST", "/auth/register", null, {
    email,
    password: "P@ssw0rd123",
    companyName,
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return { token: r.data.token, user: r.data.user };
}

async function registerJoiner(joinCode) {
  const email = `demote-user-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  const r = await request("POST", "/auth/register", null, {
    email,
    password: "P@ssw0rd123",
    joinCode,
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return { token: r.data.token, user: r.data.user };
}

async function getDefaultProjectId(token) {
  const r = await request("GET", "/projects", token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(Array.isArray(r.data) && r.data.length > 0, "expected at least one project");
  return r.data[0].id;
}

async function getJoinCode(token) {
  const r = await request("GET", "/company/join-code", token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.joinCode, "missing joinCode");
  return r.data.joinCode;
}

test("admin can demote another admin if not last; cannot demote last admin; editor cannot change roles", async () => {
  const admin = await registerCompanyAdmin(`Demotion Test Co ${Date.now()}`);
  const joinCode = await getJoinCode(admin.token);
  const projectId = await getDefaultProjectId(admin.token);

  const u2 = await registerJoiner(joinCode);
  const u3 = await registerJoiner(joinCode);

  // Add u2 as ADMIN and u3 as EDITOR (project roles)
  let r = await request("POST", `/projects/${projectId}/members`, admin.token, { userId: u2.user.id, role: "ADMIN" });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  r = await request("POST", `/projects/${projectId}/members`, admin.token, { userId: u3.user.id, role: "EDITOR" });
  assert.equal(r.status, 201, JSON.stringify(r.data));

  // Admin demotes u2 from ADMIN -> VIEWER (not last admin, should succeed)
  r = await request("PATCH", `/projects/${projectId}/members/${u2.user.id}`, admin.token, { role: "VIEWER" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.role, "VIEWER");

  // Now only admin is project ADMIN; trying to demote admin should fail
  r = await request("PATCH", `/projects/${projectId}/members/${admin.user.id}`, admin.token, { role: "VIEWER" });
  assert.equal(r.status, 409, "expected 409 for last-admin demotion");
  assert.equal(r.data?.error, "Cannot demote the last project admin");

  // Editor cannot change roles
  r = await request("PATCH", `/projects/${projectId}/members/${admin.user.id}`, u3.token, { role: "EDITOR" });
  assert.equal(r.status, 403, "expected 403 for non-admin role change");
});

