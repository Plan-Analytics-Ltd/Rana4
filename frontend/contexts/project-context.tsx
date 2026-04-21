"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { projectsApi, type Project } from "@/lib/api";

type ProjectState = {
  projects: Project[];
  loading: boolean;
  selectedProjectId: string | null;
  selectedProject: Project | null;
  selectedProjectRole: Project["myRole"] | null;
  setSelectedProjectId: (id: string | null) => void;
  refreshProjects: () => Promise<void>;
};

const STORAGE_KEY = "rana4-project-id";

const ProjectContext = createContext<ProjectState | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProjectId, setSelectedProjectIdState] = useState<string | null>(null);

  const setSelectedProjectId = useCallback((id: string | null) => {
    setSelectedProjectIdState(id);
    if (typeof window === "undefined") return;
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  }, []);

  const refreshProjects = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await projectsApi.listMine();
      setProjects(data);
      const stored = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
      const storedValid = stored && data.some((p) => p.id === stored) ? stored : null;
      const fallback = data[0]?.id ?? null;
      setSelectedProjectIdState(storedValid ?? fallback);
      if (!storedValid && fallback && typeof window !== "undefined") {
        localStorage.setItem(STORAGE_KEY, fallback);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshProjects().catch(() => {
      setProjects([]);
      setSelectedProjectIdState(null);
      setLoading(false);
    });
  }, [refreshProjects]);

  const selectedProject = useMemo(() => {
    if (!selectedProjectId) return null;
    return projects.find((p) => p.id === selectedProjectId) ?? null;
  }, [projects, selectedProjectId]);

  const selectedProjectRole = selectedProject?.myRole ?? null;

  const value = useMemo(
    () => ({ projects, loading, selectedProjectId, selectedProject, selectedProjectRole, setSelectedProjectId, refreshProjects }),
    [projects, loading, selectedProjectId, selectedProject, selectedProjectRole, setSelectedProjectId, refreshProjects]
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject(): ProjectState {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used within ProjectProvider");
  return ctx;
}

