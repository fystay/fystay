"use client";

import { Check, Copy, Link2 } from "lucide-react";
import { useState } from "react";

/** Shown to a listing's own host: the address of their page, ready to copy and share. */
export function HostPageLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the address is on screen to copy by hand.
    }
  }

  return (
    <div className="mb-8 flex flex-wrap items-center gap-3 rounded-2xl border border-brand-100 bg-brand-50 px-4 py-3">
      <Link2 className="h-4 w-4 shrink-0 text-brand-700" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-brand-900">
          Your page is ready to share
        </p>
        <p className="truncate text-sm text-brand-800">
          {url.replace(/^https?:\/\//, "")}
        </p>
      </div>
      <button
        type="button"
        onClick={copy}
        className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-700 px-3 text-sm font-semibold text-white hover:bg-brand-800"
      >
        {copied ? (
          <Check className="h-4 w-4" aria-hidden />
        ) : (
          <Copy className="h-4 w-4" aria-hidden />
        )}
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}
