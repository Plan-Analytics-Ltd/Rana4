"use client";

import { AppSidebar } from "./AppSidebar";
import { AppHeader } from "./AppHeader";
import { PageTransition } from "./PageTransition";

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen min-w-0 overflow-x-hidden bg-slate-100 dark:bg-slate-950 md:flex-row">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-white shadow-sm dark:bg-slate-900">
        <AppHeader />
        <main className="min-w-0 flex-1 overflow-hidden p-6">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </div>
  );
}
