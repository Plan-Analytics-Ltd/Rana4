import test from "node:test";
import assert from "node:assert/strict";
import { readRepoFile, withoutComments } from "./test-utils.mjs";

test("Swagger is mounted only outside production", async () => {
  const index = withoutComments(await readRepoFile("src/index.ts"));
  assert.match(index, /if \(!runtimeConfig\.isProduction\)\s*\{[\s\S]*app\.use\("\/api-docs"/);
});

test("Swagger CSP exception is scoped to /api-docs only", async () => {
  const middleware = withoutComments(await readRepoFile("src/middleware/security/securityHeaders.middleware.ts"));
  assert.match(middleware, /isDevelopmentSwaggerRoute/);
  assert.match(middleware, /req\.path === "\/api-docs" \|\| req\.path\.startsWith\("\/api-docs\/"\)/);
  assert.match(middleware, /const isSwaggerRoute = isDevelopmentSwaggerRoute\(req, config\.isProduction\)/);
  assert.match(middleware, /if \(!isSwaggerRoute\)\s*\{[\s\S]*Content-Security-Policy/);
  assert.match(middleware, /default-src 'none'; frame-ancestors 'none'/);
});

test("Swagger documentation explains development-only CSP exception", async () => {
  const testing = await readRepoFile("TESTING.md");
  assert.match(testing, /disabled when `NODE_ENV=production`/);
  assert.match(testing, /CSP exception scoped only to `\/api-docs`/);
});
