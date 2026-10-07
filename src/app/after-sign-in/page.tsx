import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { BecomeHostButton } from "@/components/BecomeHostButton";
import { Logo } from "@/components/Logo";
import { Card, CardContent } from "@/components/ui/Card";
import { buttonVariants } from "@/components/ui/Button";

export const metadata: Metadata = { title: "Signing you in", robots: { index: false } };

/**
 * Where a sign-in with no particular destination lands (Google, Apple):
 * hosts go to their hosting dashboard, everyone else home. Decided on the
 * server, so there's no flash of the wrong page on the way.
 *
 * `?as=host` is set by the sign-up form when "Host my place" was chosen
 * before tapping Google/Apple. Google and Apple accounts are always created
 * as guests (the provider round trip can't carry a trustworthy role), so a
 * guest arriving with it is asked to confirm with one tap rather than being
 * switched silently: a GET link must never change someone's account.
 */
export default async function AfterSignInPage({ searchParams }: PageProps<"/after-sign-in">) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role === "HOST") redirect("/host/dashboard");

  const { as } = await searchParams;
  if (as !== "host" || session.user.role !== "GUEST") redirect("/");

  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 py-12 sm:py-16">
      <Logo />
      <Card className="mt-6">
        <CardContent className="pt-6">
          <h1 className="text-xl font-semibold text-stone-900">You&apos;re signed in. Ready to host?</h1>
          <p className="mt-2 text-sm text-stone-600">
            Turn on hosting to list your place. You can still book stays with the same account.
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <BecomeHostButton className={buttonVariants({ size: "lg" })}>Start hosting</BecomeHostButton>
            <Link href="/" className={buttonVariants({ variant: "ghost" })}>
              Not now, browse stays
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
