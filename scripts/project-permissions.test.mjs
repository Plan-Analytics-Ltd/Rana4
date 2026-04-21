/**
 * Permission matrix unit tests (frontend + backend mirror intent).
 *
 * Run:
 *   npm run build && node --test scripts/project-permissions.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";

import { checkPermission, hasPermission, permissions } from "../dist/permissions/projectPermissions.js";

const ROLES = ["VIEWER", "EDITOR", "ADMIN"];

test("permissions map is well-formed", () => {
  for (const [entity, actions] of Object.entries(permissions)) {
    assert.ok(entity);
    for (const [action, roles] of Object.entries(actions)) {
      assert.ok(action);
      assert.ok(Array.isArray(roles), "roles must be array");
      for (const r of roles) {
        assert.ok(ROLES.includes(r), `unknown role ${r} in ${entity}.${action}`);
      }
    }
  }
});

test("every entity/action pair is explicitly defined", () => {
  const entities = Object.keys(permissions);
  assert.ok(entities.length > 0);
  const actions = ["read", "create", "update", "delete", "manageMembers"];
  for (const entity of entities) {
    for (const action of actions) {
      assert.ok(permissions[entity][action], `missing ${entity}.${action}`);
    }
  }
});

test("undefined entity/action throws (no fallback)", () => {
  assert.throws(() => hasPermission("ADMIN", "nope", "read"));
  assert.throws(() => hasPermission("ADMIN", "activity", "nope"));
});

test("role hierarchy matches expected core CRUD rules", () => {
  // Viewer: read-only for core entities
  assert.equal(hasPermission("VIEWER", "activity", "read"), true);
  assert.equal(hasPermission("VIEWER", "activity", "create"), false);
  assert.equal(hasPermission("VIEWER", "activity", "update"), false);
  assert.equal(hasPermission("VIEWER", "activity", "delete"), false);

  // Editor: full CRUD for core entities (delete still subject to state rules)
  assert.equal(hasPermission("EDITOR", "deliverable", "read"), true);
  assert.equal(hasPermission("EDITOR", "deliverable", "create"), true);
  assert.equal(hasPermission("EDITOR", "deliverable", "update"), true);
  assert.equal(hasPermission("EDITOR", "deliverable", "delete"), true);

  // Admin: full CRUD
  assert.equal(hasPermission("ADMIN", "standard", "delete"), true);
  assert.equal(hasPermission("ADMIN", "relationship", "delete"), true);
});

test("project management allowed for editor/admin", () => {
  assert.equal(hasPermission("VIEWER", "project", "create"), false);
  assert.equal(hasPermission("EDITOR", "project", "create"), true);
  assert.equal(hasPermission("EDITOR", "project", "update"), true);
  assert.equal(hasPermission("EDITOR", "project", "delete"), true);
});

test("member management is admin-only", () => {
  assert.equal(hasPermission("VIEWER", "projectMember", "create"), false);
  assert.equal(hasPermission("EDITOR", "projectMember", "update"), false);
  assert.equal(hasPermission("ADMIN", "projectMember", "delete"), true);
});

test("rate card management allowed for editor/admin", () => {
  assert.equal(hasPermission("VIEWER", "rateCard", "create"), false);
  assert.equal(hasPermission("EDITOR", "rateCard", "create"), true);
  assert.equal(hasPermission("EDITOR", "rateCard", "update"), true);
  assert.equal(hasPermission("EDITOR", "rateCard", "delete"), true);
  assert.equal(hasPermission("ADMIN", "rateCard", "delete"), true);
});

test("role allows but rule blocks → denied (projectMember delete last admin)", () => {
  const r = checkPermission("ADMIN", "projectMember", "delete", { isLastAdmin: true });
  assert.equal(r.ok, false);
  assert.equal(r.kind, "rule");
});

test("role + rule both allow → success (projectMember delete not last admin)", () => {
  const r = checkPermission("ADMIN", "projectMember", "delete", { isLastAdmin: false });
  assert.deepEqual(r, { ok: true });
});

test("activity delete blocked when dependencies exist", () => {
  const r = checkPermission("ADMIN", "activity", "delete", { hasDependencies: true });
  assert.equal(r.ok, false);
  assert.equal(r.kind, "rule");
});

