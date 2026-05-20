export type ExportHistoryEntry = {
  id: string;
  at: string;
  /** Rana4 workspace project id */
  ranaProjectId: string;
  mode: "FRAGNET" | "STANDARD";
  targetName: string;
  scenario: "best" | "likely";
  /** P6 project id entered at export time */
  p6ProjectId: string;
  p6ProjectName: string;
  status: "success" | "failure";
  durationMs?: number;
  filename?: string;
  error?: string;
  validationErrors?: number;
  validationWarnings?: number;
};

const KEY = "rana4-export-history";

export function loadExportHistory(ranaProjectId: string): ExportHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const all = JSON.parse(raw) as ExportHistoryEntry[];
    return all
      .filter((e) => e.ranaProjectId === ranaProjectId || (e as { projectId?: string }).projectId === ranaProjectId)
      .slice(0, 30);
  } catch {
    return [];
  }
}

export function appendExportHistory(entry: ExportHistoryEntry): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(KEY);
    const all: ExportHistoryEntry[] = raw ? JSON.parse(raw) : [];
    all.unshift(entry);
    localStorage.setItem(KEY, JSON.stringify(all.slice(0, 100)));
  } catch {
    /* ignore */
  }
}
