import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

export const metadata: Metadata = { title: "Signing you in", robots: { index: false } };

/**
 * Where a sign-in with no particular destination lands (Google, Apple):
 * hosts go to their hosting dashboard, everyone else home. Decided on the
 * server, so there's no flash of the wrong page on the way.
 */
export default async function AfterSignInPage() {
  const session = await auth();
  redirect(session?.user?.role === "HOST" ? "/host/dashboard" : "/");
}
