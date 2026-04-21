"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { getApiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function SignupInner() {
  const { user, loading, register } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("token")?.trim() || "";
  const joinCodeFromUrl =
    searchParams.get("joinCode")?.trim() || searchParams.get("code")?.trim() || "";
  const [email, setEmail] = useState("");
  const [joinCode, setJoinCode] = useState(joinCodeFromUrl);
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const fromUrl =
      searchParams.get("joinCode")?.trim() || searchParams.get("code")?.trim() || "";
    if (fromUrl) setJoinCode(fromUrl);
  }, [searchParams]);

  useEffect(() => {
    if (!loading && user) router.replace("/app");
  }, [user, loading, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setSubmitting(true);
    try {
      const jc = joinCode.trim();
      const cn = companyName.trim();
      await register(
        email,
        password,
        name.trim() || undefined,
        inviteToken || undefined,
        inviteToken ? undefined : jc || undefined,
        inviteToken ? undefined : !jc && cn ? cn : undefined
      );
    } catch (err) {
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
      <Card className="w-full max-w-md dark:border-slate-800 dark:bg-slate-900/50">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-xl font-semibold">
            {inviteToken ? "Accept invitation" : "Create an account"}
          </CardTitle>
          <CardDescription>
            {inviteToken ? (
              "Create your account to join your company."
            ) : (
              <>
                <span className="block font-medium text-slate-700 dark:text-slate-200">
                  Create a new company or join an existing one with a join code.
                </span>
                <span className="mt-1 block text-slate-600 dark:text-slate-400">
                  Invite link from your admin opens this page with the code filled in. No join code is used when you sign
                  in later — only email and password.
                </span>
              </>
            )}
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
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
                minLength={8}
                className="dark:border-slate-700 dark:bg-slate-900"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="name" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Display name <span className="text-slate-400">(optional)</span>
              </label>
              <Input
                id="name"
                type="text"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                className="dark:border-slate-700 dark:bg-slate-900"
              />
            </div>
            {!inviteToken && (
              <>
                <div className="space-y-2">
                  <label htmlFor="companyName" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    New company name <span className="text-slate-400">(optional)</span>
                  </label>
                  <Input
                    id="companyName"
                    type="text"
                    placeholder="e.g. Acme Inc — only if you are not using a join code"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    autoComplete="organization"
                    className="dark:border-slate-700 dark:bg-slate-900"
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="joinCode" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Join code <span className="text-slate-400">(optional)</span>
                  </label>
                  <Input
                    id="joinCode"
                    type="text"
                    placeholder="From your admin invite link"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono dark:border-slate-700 dark:bg-slate-900"
                  />
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    If both are filled, the join code is used first. Leave both empty only when using an invitation link
                    above.
                  </p>
                </div>
              </>
            )}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Creating account…" : "Sign up"}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-slate-500 dark:text-slate-400">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-cyan-600 hover:underline dark:text-cyan-400">
              Sign in
            </Link>
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

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-100 dark:bg-slate-950">
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
        </div>
      }
    >
      <SignupInner />
    </Suspense>
  );
}
