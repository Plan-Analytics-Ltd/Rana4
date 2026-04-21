import { prisma } from "../utils/prisma.js";

export type AuthedUser = {
  id: string;
  companyId: string;
  role: "ADMIN" | "EDITOR" | "VIEWER";
};

export type ProjectMembership = {
  projectId: string;
  userId: string;
  role: "ADMIN" | "EDITOR" | "VIEWER";
};

export async function requireProjectAccess(
  projectId: string,
  user: AuthedUser,
  opts?: { adminOverride?: boolean }
): Promise<ProjectMembership> {
  const adminOverride = opts?.adminOverride ?? true;
  if (adminOverride && user.role === "ADMIN") {
    const project = await prisma.project.findFirst({
      where: { id: projectId, companyId: user.companyId },
      select: { id: true },
    });
    if (!project) {
      const err = new Error("Unauthorized project access");
      (err as any).status = 403;
      throw err;
    }
    return { projectId, userId: user.id, role: "ADMIN" };
  }

  const membership = await prisma.projectMember.findFirst({
    where: {
      projectId,
      userId: user.id,
      project: { companyId: user.companyId },
    },
    select: { projectId: true, userId: true, role: true },
  });

  if (!membership) {
    const err = new Error("Unauthorized project access");
    (err as any).status = 403;
    throw err;
  }

  return membership;
}

