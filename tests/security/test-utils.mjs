import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(__dirname, "../..");

export function repoPath(...parts) {
  return resolve(repoRoot, ...parts);
}

export async function readRepoFile(...parts) {
  return readFile(repoPath(...parts), "utf8");
}

export function assertOrdered(content, first, second, message) {
  const firstIndex = content.indexOf(first);
  const secondIndex = content.indexOf(second);
  if (firstIndex === -1 || secondIndex === -1 || firstIndex > secondIndex) {
    throw new Error(message ?? `Expected ${first} before ${second}`);
  }
}

export function withoutComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}
