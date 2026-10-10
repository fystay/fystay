import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { enabledSocialProviders } from "@/lib/authProviders";
import { OAUTH_PENDING_PROVIDER_COOKIE } from "@/lib/authErrors";
import { RegisterForm } from "@/components/RegisterForm";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Sign up",
  description: "Create a free FYStay account to book your stay or start hosting your holiday let.",
  path: "/register",
});

export default async function RegisterPage() {
  const session = await auth();
  if (session?.user) redirect("/");

  const rememberedProvider = (await cookies()).get(OAUTH_PENDING_PROVIDER_COOKIE)?.value ?? null;
  return <RegisterForm providers={enabledSocialProviders()} rememberedProvider={rememberedProvider} />;
}
