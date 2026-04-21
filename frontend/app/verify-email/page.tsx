"use client";

import { Suspense } from "react";
import Link from "next/link";

function VerifyEmailInner() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Verify your email</h1>
        <p className="mt-2 text-sm text-gray-600">
          New accounts are active immediately. If your organization uses email confirmation separately, follow their
          instructions, then sign in here.
        </p>
        <p className="mt-4 text-center text-sm text-gray-600">
          <Link className="underline" href="/login">
            Go to login
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailInner />
    </Suspense>
  );
}

