import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const nextConfig: NextConfig = {
  // Monorepo: repo root also has a package-lock.json; without this, Next may infer the wrong workspace root.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
