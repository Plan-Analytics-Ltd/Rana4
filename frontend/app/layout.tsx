import type { Metadata } from "next";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/contexts/auth-context";
import { AskRanaFeatureProvider } from "@/contexts/ask-rana-feature-context";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rana4 — Structured Scheduling. Reimagined.",
  description: "Standardised Fragnets, Dual-Duration Modelling, Deterministic Export.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100">
        <ThemeProvider>
          <AuthProvider>
            <AskRanaFeatureProvider>
              {children}
              <Toaster position="top-right" richColors closeButton />
            </AskRanaFeatureProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
