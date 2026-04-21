import { AppLayout } from "@/components/layout/AppLayout";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { ProjectProvider } from "@/contexts/project-context";

export default function AppShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RequireAuth>
      <ProjectProvider>
        <AppLayout>{children}</AppLayout>
      </ProjectProvider>
    </RequireAuth>
  );
}
