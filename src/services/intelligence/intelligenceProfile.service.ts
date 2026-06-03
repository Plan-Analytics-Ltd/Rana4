import { prisma } from "../../utils/prisma.js";

export type IntelligenceProfilePatch = {
  sector?: string | null;
  projectType?: string | null;
  procurementRoute?: string | null;
  stage?: string | null;
  region?: string | null;
  clientType?: string | null;
  complexity?: string | null;
  classificationTags?: string[] | null;
  disciplineTags?: string[] | null;
};

function normStr(v: unknown): string | null {
  const s = v == null ? "" : String(v).trim();
  return s ? s : null;
}

function normStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const s = normStr(x);
    if (s) out.push(s);
  }
  return [...new Set(out)];
}

function isEmptyTags(v: unknown): boolean {
  return !Array.isArray(v) || v.length === 0;
}

export async function createProfile(projectId: string, companyId: string) {
  return prisma.projectIntelligenceProfile.upsert({
    where: { projectId },
    create: {
      projectId,
      companyId,
      sector: null,
      projectType: null,
      procurementRoute: null,
      stage: null,
      region: null,
      clientType: null,
      complexity: null,
      classificationTagsList: [],
      disciplineTags: [],
      // Keep legacy fields intact/empty for backwards compatibility
      primaryRibaStage: null,
      complexityScore: null,
      classificationTags: {},
      complexityMetrics: {},
    },
    update: {},
  });
}

export async function getProfile(projectId: string, companyId: string) {
  const existing = await prisma.projectIntelligenceProfile.findFirst({ where: { projectId, companyId } });
  if (existing) return existing;
  return createProfile(projectId, companyId);
}

/**
 * Auto-populate from latest imported programme snapshot metadata.
 * Does NOT overwrite manually entered values.
 */
export async function autoPopulateFromImportedProgrammeMetadata(projectId: string, companyId: string) {
  const [profile, latestSnapshot] = await Promise.all([
    getProfile(projectId, companyId),
    prisma.programmeSnapshot.findFirst({
      where: { projectId, companyId },
      orderBy: { importedAt: "desc" },
      select: {
        sector: true,
        projectType: true,
        procurementRoute: true,
        stage: true,
        region: true,
        clientType: true,
        complexity: true,
        classificationTagsList: true,
        disciplineTags: true,
      },
    }),
  ]);

  if (!latestSnapshot) return profile;

  const nextData: any = {};

  if (profile.sector == null && latestSnapshot.sector) nextData.sector = latestSnapshot.sector;
  if (profile.projectType == null && latestSnapshot.projectType) nextData.projectType = latestSnapshot.projectType;
  if (profile.procurementRoute == null && latestSnapshot.procurementRoute)
    nextData.procurementRoute = latestSnapshot.procurementRoute;
  if (profile.stage == null && latestSnapshot.stage) nextData.stage = latestSnapshot.stage;
  if (profile.region == null && latestSnapshot.region) nextData.region = latestSnapshot.region;
  if (profile.clientType == null && latestSnapshot.clientType) nextData.clientType = latestSnapshot.clientType;
  if (profile.complexity == null && latestSnapshot.complexity) nextData.complexity = latestSnapshot.complexity;

  if (isEmptyTags(profile.classificationTagsList) && !isEmptyTags(latestSnapshot.classificationTagsList)) {
    nextData.classificationTagsList = normStringArray(latestSnapshot.classificationTagsList);
  }
  if (isEmptyTags(profile.disciplineTags) && !isEmptyTags(latestSnapshot.disciplineTags)) {
    nextData.disciplineTags = normStringArray(latestSnapshot.disciplineTags);
  }

  if (Object.keys(nextData).length === 0) return profile;

  return prisma.projectIntelligenceProfile.update({
    where: { id: profile.id },
    data: nextData,
  });
}

export async function updateProfile(projectId: string, companyId: string, patch: IntelligenceProfilePatch) {
  const existing = await getProfile(projectId, companyId);

  const data: any = {};
  if ("sector" in patch) data.sector = patch.sector === undefined ? undefined : normStr(patch.sector);
  if ("projectType" in patch) data.projectType = patch.projectType === undefined ? undefined : normStr(patch.projectType);
  if ("procurementRoute" in patch)
    data.procurementRoute = patch.procurementRoute === undefined ? undefined : normStr(patch.procurementRoute);
  if ("stage" in patch) data.stage = patch.stage === undefined ? undefined : normStr(patch.stage);
  if ("region" in patch) data.region = patch.region === undefined ? undefined : normStr(patch.region);
  if ("clientType" in patch) data.clientType = patch.clientType === undefined ? undefined : normStr(patch.clientType);
  if ("complexity" in patch) data.complexity = patch.complexity === undefined ? undefined : normStr(patch.complexity);

  if ("classificationTags" in patch) {
    data.classificationTagsList = patch.classificationTags == null ? [] : normStringArray(patch.classificationTags);
  }
  if ("disciplineTags" in patch) {
    data.disciplineTags = patch.disciplineTags == null ? [] : normStringArray(patch.disciplineTags);
  }

  return prisma.projectIntelligenceProfile.update({
    where: { id: existing.id },
    data,
  });
}

