import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { enabledSocialProviders } from "@/lib/authProviders";
import { OAUTH_PENDING_PROVIDER_COOKIE } from "@/lib/authErrors";
import { LoginForm } from "@/components/LoginForm";

export const metadata: Metadata = { title: "Log in", robots: { index: false } };

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/");

  const rememberedProvider = (await cookies()).get(OAUTH_PENDING_PROVIDER_COOKIE)?.value ?? null;
  return <LoginForm providers={enabledSocialProviders()} rememberedProvider={rememberedProvider} />;
}
