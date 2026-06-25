/**
 * One-shot import path fixer for repository maturity refactor.
 * Run: node tools/refactor-fix-imports.mjs
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, dirname, relative, basename } from "node:path";

const root = process.cwd();

const moduleLocations = {
  "types.js": "shared/types.js",
  "intelligenceConstants.js": "shared/intelligenceConstants.js",
  "intelligenceMath.js": "shared/intelligenceMath.js",
  "outlier.service.js": "shared/outlier.service.js",
  "similarity.service.js": "shared/similarity.service.js",
  "durationEvidence.service.js": "shared/durationEvidence.service.js",
  "plannedVsActual.service.js": "shared/plannedVsActual.service.js",
  "xerParse.service.js": "shared/xerParse.service.js",
  "programmeImport.service.js": "shared/programmeImport.service.js",
  "programmeSnapshotCapture.service.js": "shared/programmeSnapshotCapture.service.js",
  "rana4ScheduleExport.service.js": "shared/rana4ScheduleExport.service.js",
  "benchmark.service.js": "benchmark/benchmark.service.js",
  "portfolioBenchmark.service.js": "benchmark/portfolioBenchmark.service.js",
  "learningEngine.service.js": "learning/learningEngine.service.js",
  "learningMaturity.service.js": "learning/learningMaturity.service.js",
  "learningRefresh.service.js": "learning/learningRefresh.service.js",
  "lessonsLearned.service.js": "learning/lessonsLearned.service.js",
  "outcomePrediction.service.js": "prediction/outcomePrediction.service.js",
  "forecastReliability.service.js": "prediction/forecastReliability.service.js",
  "expectedDuration.service.js": "prediction/expectedDuration.service.js",
  "recommendationEngine.service.js": "recommendations/recommendationEngine.service.js",
  "intelligenceTrust.service.js": "trust/intelligenceTrust.service.js",
  "findings.service.js": "findings/findings.service.js",
  "driverAnalysis.service.js": "drivers/driverAnalysis.service.js",
  "intelligenceOrchestrator.service.js": "orchestration/intelligenceOrchestrator.service.js",
  "intelligenceMetadata.service.js": "orchestration/intelligenceMetadata.service.js",
  "intelligenceProfile.service.js": "profiles/intelligenceProfile.service.js",
  "deliverableKnowledgeProfile.service.js": "profiles/deliverableKnowledgeProfile.service.js",
  "deliverableClassification.service.js": "profiles/deliverableClassification.service.js",
};

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, files);
    else if (p.endsWith(".ts")) files.push(p);
  }
  return files;
}

function relImport(fromDir, targetPath) {
  const intelRoot = join(root, "src/services/intelligence").replace(/\\/g, "/");
  const fromRel = relative(intelRoot, fromDir).replace(/\\/g, "/");
  const targetDir = dirname(targetPath).replace(/\\/g, "/");

  if (fromRel === targetDir) {
    return `./${basename(targetPath)}`;
  }

  const fromParts = fromRel ? fromRel.split("/") : [];
  const up = fromParts.length;
  const prefix = up === 0 ? "./" : "../".repeat(up);
  return prefix + targetPath;
}

function fixIntelligenceFile(filePath) {
  let content = readFileSync(filePath, "utf8");
  const dir = dirname(filePath);

  content = content.replace(/from ["']\.\.\/\.\.\/utils\/prisma\.js["']/g, 'from "../../../utils/prisma.js"');

  for (const [mod, loc] of Object.entries(moduleLocations)) {
    const rel = relImport(dir, loc);
    const patterns = [
      new RegExp(`from ["']\\./${mod.replace(".", "\\.")}["']`, "g"),
      new RegExp(`import\\(["']\\./${mod.replace(".", "\\.")}["']\\)`, "g"),
    ];
    for (const re of patterns) {
      content = content.replace(re, (m) => m.replace(`./${mod}`, rel.replace(/\.js$/, ".js")));
    }
  }

  writeFileSync(filePath, content);
}

function fixFile(filePath, replacements) {
  let content = readFileSync(filePath, "utf8");
  let changed = false;
  for (const [from, to] of replacements) {
    if (content.includes(from)) {
      content = content.split(from).join(to);
      changed = true;
    }
  }
  if (changed) writeFileSync(filePath, content);
}

const intelFiles = walk(join(root, "src/services/intelligence"));
for (const f of intelFiles) fixIntelligenceFile(f);

const globalReplacements = [
  ['../services/intelligence/intelligenceOrchestrator.service', '../services/intelligence/orchestration/intelligenceOrchestrator.service'],
  ['../services/intelligence/intelligenceMetadata.service', '../services/intelligence/orchestration/intelligenceMetadata.service'],
  ['../services/intelligence/intelligenceProfile.service', '../services/intelligence/profiles/intelligenceProfile.service'],
  ['../services/intelligence/deliverableKnowledgeProfile.service', '../services/intelligence/profiles/deliverableKnowledgeProfile.service'],
  ['../services/intelligence/deliverableClassification.service', '../services/intelligence/profiles/deliverableClassification.service'],
  ['../services/intelligence/benchmark.service', '../services/intelligence/benchmark/benchmark.service'],
  ['../services/intelligence/portfolioBenchmark.service', '../services/intelligence/benchmark/portfolioBenchmark.service'],
  ['../services/intelligence/similarity.service', '../services/intelligence/shared/similarity.service'],
  ['../services/intelligence/findings.service', '../services/intelligence/findings/findings.service'],
  ['../services/intelligence/driverAnalysis.service', '../services/intelligence/drivers/driverAnalysis.service'],
  ['../services/intelligence/recommendationEngine.service', '../services/intelligence/recommendations/recommendationEngine.service'],
  ['../services/intelligence/forecastReliability.service', '../services/intelligence/prediction/forecastReliability.service'],
  ['../services/intelligence/outcomePrediction.service', '../services/intelligence/prediction/outcomePrediction.service'],
  ['../services/intelligence/learningEngine.service', '../services/intelligence/learning/learningEngine.service'],
  ['../services/intelligence/intelligenceTrust.service', '../services/intelligence/trust/intelligenceTrust.service'],
  ['../services/intelligence/learningRefresh.service', '../services/intelligence/learning/learningRefresh.service'],
  ['../services/intelligence/programmeImport.service', '../services/intelligence/shared/programmeImport.service'],
  ['../services/intelligence/programmeSnapshotCapture.service', '../services/intelligence/shared/programmeSnapshotCapture.service'],
  ['../services/intelligence/plannedVsActual.service', '../services/intelligence/shared/plannedVsActual.service'],
  ['../services/intelligence/lessonsLearned.service', '../services/intelligence/learning/lessonsLearned.service'],
  ['../services/intelligence/rana4ScheduleExport.service', '../services/intelligence/shared/rana4ScheduleExport.service'],
  ['../services/intelligence/durationEvidence.service', '../services/intelligence/shared/durationEvidence.service'],
  ['../intelligence/intelligenceOrchestrator.service', '../intelligence/orchestration/intelligenceOrchestrator.service'],
  ['../intelligence/durationEvidence.service', '../intelligence/shared/durationEvidence.service'],
  ['../intelligence/intelligenceTrust.service', '../intelligence/trust/intelligenceTrust.service'],
  ['../services/auditDiff.service', '../services/shared/auditDiff.service'],
  ['./auditDiff.service', './shared/auditDiff.service'],
  ['from "./openapi.js"', 'from "./api/openapi.js"'],
  ['"src", "openapi.json"', '"src", "api", "openapi.json"'],
  ['../services/explanation/explanationContext.builder', '../services/explanation/context/explanationContext.builder'],
  ['../services/explanation/explanationConfig', '../services/explanation/explanationConfig'],
  ['../services/explanation/explanationCitations', '../services/explanation/citations/explanationCitations'],
  ['../services/explanation/explanationLogger', '../services/explanation/logging/explanationLogger'],
  ['../services/explanation/explanationPrompt.builder', '../services/explanation/prompt/explanationPrompt.builder'],
  ['../services/explanation/explanationPromptSanitizer', '../services/explanation/prompt/explanationPromptSanitizer'],
  ['../services/explanation/explanationTypes', '../services/explanation/types/explanationTypes'],
  ['../services/explanation/explanationValidator.service', '../services/explanation/validation/explanationValidator.service'],
  ['../services/explanation/llm/openaiLlmProvider', '../services/integrations/openai/openaiLlmProvider'],
  ['../services/explanation/llm/mockLlmProvider', '../services/explanation/providers/mockLlmProvider'],
  ['../services/explanation/llm/llmProviderRegistry', '../services/explanation/providers/llmProviderRegistry'],
  ['./explanationContext.builder', './context/explanationContext.builder'],
  ['./explanationConfig', './explanationConfig'],
  ['./explanationCitations', './citations/explanationCitations'],
  ['./explanationLogger', './logging/explanationLogger'],
  ['./explanationPrompt.builder', './prompt/explanationPrompt.builder'],
  ['./explanationPromptSanitizer', './prompt/explanationPromptSanitizer'],
  ['./explanationTypes', './types/explanationTypes'],
  ['./explanationValidator.service', './validation/explanationValidator.service'],
  ['./llm/llmProviderRegistry', './providers/llmProviderRegistry'],
  ['./llm/llmProvider.types', './providers/llmProvider.types'],
  ['./llm/mockLlmProvider', './providers/mockLlmProvider'],
  ['./llm/openaiLlmProvider', '../../integrations/openai/openaiLlmProvider'],
  ['../explanationConfig', '../explanationConfig'],
  ['../explanationPrompt.builder', '../prompt/explanationPrompt.builder'],
  ['TESTING.md', 'docs/testing/TESTING.md'],
];

const allTs = walk(join(root, "src"));
for (const f of allTs) fixFile(f, globalReplacements);

const allMjs = [
  ...walk(join(root, "tests")),
  ...walk(join(root, "scripts")),
];
for (const f of allMjs) {
  if (!f.endsWith(".mjs")) continue;
  fixFile(f, [
    ...globalReplacements,
    ['../dist/services/intelligence/intelligenceOrchestrator.service', '../dist/services/intelligence/orchestration/intelligenceOrchestrator.service'],
    ['../dist/services/explanation/explanationPrompt.builder', '../dist/services/explanation/prompt/explanationPrompt.builder'],
    ['../dist/services/explanation/explanationCitations', '../dist/services/explanation/citations/explanationCitations'],
    ['../dist/services/explanation/explanationTypes', '../dist/services/explanation/types/explanationTypes'],
    ['../dist/services/explanation/explanationValidator.service', '../dist/services/explanation/validation/explanationValidator.service'],
    ['../dist/services/explanation/explanationPromptSanitizer', '../dist/services/explanation/prompt/explanationPromptSanitizer'],
    ['../dist/services/explanation/llm/openaiLlmProvider', '../dist/services/integrations/openai/openaiLlmProvider'],
    ['../dist/services/explanation/llm/mockLlmProvider', '../dist/services/explanation/providers/mockLlmProvider'],
    ['../dist/services/auditDiff.service', '../dist/services/shared/auditDiff.service'],
    ['../../dist/', '../../dist/'],
  ]);
}

// integration tests moved: ../dist -> ../../dist
for (const f of walk(join(root, "tests/integration"))) {
  if (!f.endsWith(".mjs")) continue;
  fixFile(f, [['from "../dist/', 'from "../../dist/']]);
}

// e2e in scripts/validation/e2e
fixFile(join(root, "scripts/validation/e2e/e2e-validation.mjs"), [
  ['from "../dist/', 'from "../../../dist/'],
]);

// smoke scripts one level deeper
for (const f of walk(join(root, "scripts/validation"))) {
  if (!f.endsWith(".mjs") && !f.endsWith(".ts")) continue;
  if (f.includes("e2e")) continue;
  fixFile(f, [['from "../dist/', 'from "../../../dist/']]);
}

// maintenance scripts
for (const f of walk(join(root, "scripts/maintenance"))) {
  if (!f.endsWith(".mjs")) continue;
  fixFile(f, [['from "../dist/', 'from "../../../dist/']]);
}

console.log("Import fixes applied.");
