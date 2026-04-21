"use client";

import { Suspense, useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { getApiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function LoginInner() {
  const { user, loading, login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next")?.trim() || "";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  /** Avoid racing `login()` navigation (e.g. to /dev) with “already signed in → /app”. */
  const loginSubmitNavigation = useRef(false);

  useEffect(() => {
    if (!loading && user && !loginSubmitNavigation.current) {
      router.replace("/app");
    }
  }, [user, loading, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    loginSubmitNavigation.current = true;
    try {
      await login(email, password, next ? { redirectTo: next } : undefined);
    } catch (err) {
      loginSubmitNavigation.current = false;
      setError(getApiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 dark:bg-slate-950">
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-100 px-4 dark:bg-slate-950">
      <Card className="w-full max-w-sm dark:border-slate-800 dark:bg-slate-900/50">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-xl font-semibold">Sign in</CardTitle>
          <CardDescription>
            Use your email and password only. Join codes are for sign up, not for this screen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
                {error}
              </p>
            )}
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Email
              </label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                className="dark:border-slate-700 dark:bg-slate-900"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Password
              </label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                className="dark:border-slate-700 dark:bg-slate-900"
              />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-slate-500 dark:text-slate-400">
            Need an account?{" "}
            <Link href="/signup" className="font-medium text-cyan-600 hover:underline dark:text-cyan-400">
              Sign up
            </Link>{" "}
            with a company join code or new company name.
          </p>
        </CardContent>
      </Card>
      <p className="mt-6">
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300">
          ← Back to home
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-100 dark:bg-slate-950">
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
        </div>
      }
    >
      <LoginInner />
    </Suspense>
  );
}
