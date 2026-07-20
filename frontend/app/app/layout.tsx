import { AppLayout } from "@/components/layout/AppLayout";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { ProjectProvider } from "@/contexts/project-context";
import { SearchProvider } from "@/contexts/search-context";
import { AskRanaFeatureGate } from "@/components/ask-rana/ask-rana-feature-gate";

export default function AppShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RequireAuth>
      <ProjectProvider>
        <SearchProvider>
          <AskRanaFeatureGate>
            <AppLayout>{children}</AppLayout>
          </AskRanaFeatureGate>
        </SearchProvider>
      </ProjectProvider>
    </RequireAuth>
  );
}
