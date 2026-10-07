"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import * as Sentry from "@sentry/nextjs";
import { Button, buttonVariants } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

/**
 * A hosting page that failed to load (a dropped connection, a database
 * hiccup) keeps the hosting menu above it and offers the two things a host
 * actually wants: try again, or get back to Today. Nothing they did is lost.
 */
export default function HostError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 py-20 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-700">
        <RefreshCw className="h-6 w-6" aria-hidden />
      </span>
      <h1 className="mt-4 font-serif text-2xl text-foreground">This page didn&apos;t load</h1>
      <p className="mt-2 text-sm text-stone-600">
        It&apos;s usually a brief connection problem. Your bookings and listings are safe - try again in a moment.
      </p>
      <div className="mt-6 flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <Link href="/host/dashboard" className={cn(buttonVariants({ variant: "outline" }))}>
          Back to Today
        </Link>
      </div>
      {error.digest && <p className="mt-6 text-xs text-stone-400">Reference: {error.digest}</p>}
    </div>
  );
}
