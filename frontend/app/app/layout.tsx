import { AppLayout } from "@/components/layout/AppLayout";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { IntelligenceModeProvider } from "@/contexts/intelligence-mode-context";
import { ProjectProvider } from "@/contexts/project-context";
import { SearchProvider } from "@/contexts/search-context";
import { IntelligenceDrawerProvider } from "@/contexts/intelligence-drawer-context";
import { AskRanaProvider } from "@/contexts/ask-rana-context";

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
            <IntelligenceDrawerProvider>
              <AskRanaProvider>
                <AppLayout>{children}</AppLayout>
              </AskRanaProvider>
            </IntelligenceDrawerProvider>
          </SearchProvider>
        </IntelligenceModeProvider>
      </ProjectProvider>
    </RequireAuth>
  );
}
