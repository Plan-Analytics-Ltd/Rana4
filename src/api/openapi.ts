/**
 * OpenAPI 3.0 spec for Rana4 API. Served at /api-docs (Swagger UI).
 * Spec lives in openapi.json to avoid esbuild parse issues with large object literals.
 * Uses process.cwd() so this works when compiled to CommonJS (e.g. tsc output).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const specPath = join(process.cwd(), "src", "api", "openapi.json");

export const openApiSpec = JSON.parse(readFileSync(specPath, "utf-8"));
