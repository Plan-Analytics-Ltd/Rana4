import { AppLayout } from "@/components/layout/AppLayout";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { IntelligenceModeProvider } from "@/contexts/intelligence-mode-context";
import { ProjectProvider } from "@/contexts/project-context";
import { SearchProvider } from "@/contexts/search-context";

export default function AppShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RequireAuth>
      <ProjectProvider>
        <IntelligenceModeProvider>
          <SearchProvider>
            <AppLayout>{children}</AppLayout>
          </SearchProvider>
        </IntelligenceModeProvider>
      </ProjectProvider>
    </RequireAuth>
  );
}
