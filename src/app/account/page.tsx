import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { UserCircle } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";
import { isPhoneVerificationConfigured } from "@/lib/phoneVerification";
import { IdentityVerificationCard } from "@/components/IdentityVerificationCard";
import { PhoneVerificationCard } from "@/components/PhoneVerificationCard";
import { PrivacyDataCard } from "@/components/PrivacyDataCard";
import { ProfileCard } from "@/components/ProfileCard";
import { EmailChangeCard } from "@/components/EmailChangeCard";
import { EmailVerificationNotice } from "@/components/EmailVerificationNotice";
import { SecuritySessionsCard } from "@/components/SecuritySessionsCard";
import { TwoFactorCard } from "@/components/TwoFactorCard";
import { SignInMethodsCard, type ConnectedIdentity } from "@/components/SignInMethodsCard";
import { enabledSocialProviders } from "@/lib/authProviders";
import { isOAuthProvider } from "@/lib/oauthProviders";
import { isTwoFactorConfigured } from "@/lib/twoFactorCrypto";

export const metadata: Metadata = { title: "Account", robots: { index: false } };

export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login?callbackUrl=/account");
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: {
      name: true,
      email: true,
      image: true,
      phone: true,
      phoneVerifiedAt: true,
      identityVerificationStatus: true,
      passwordHash: true,
      twoFactorEnabledAt: true,
      emailVerifiedAt: true,
      authIdentities: { select: { provider: true, email: true }, orderBy: { createdAt: "asc" } },
    },
  });
  const identities: ConnectedIdentity[] = user.authIdentities.flatMap(({ provider, email }) =>
    isOAuthProvider(provider) ? [{ provider, email }] : [],
  );
  // Google-only accounts never go through the password/code check in
  // src/auth.ts's authorize() at all, so 2FA has nothing to actually gate
  // for them - offering the toggle would promise a protection it can't
  // deliver, so it's simply not shown until the account also has a
  // password (see the "Set a password" flow this app doesn't yet have for
  // Google accounts - a separate, real gap, not silently worked around
  // here).
  const hasPassword = Boolean(user.passwordHash);
  const { emailVerified } = await searchParams;

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
          <UserCircle className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Account</h1>
          <p className="text-sm text-stone-500">Manage your trust and safety details.</p>
        </div>
      </div>

      <div className="mt-6">
        <EmailVerificationNotice
          verified={Boolean(user.emailVerifiedAt)}
          outcome={typeof emailVerified === "string" ? emailVerified : null}
          email={user.email}
        />
      </div>

      <div className="mt-6">
        <ProfileCard initialName={user.name} email={user.email} image={user.image} />
      </div>

      <div className="mt-6 flex flex-col gap-4">
        {hasPassword && <EmailChangeCard currentEmail={user.email} />}
        <IdentityVerificationCard
          status={user.identityVerificationStatus}
          configured={Boolean(getStripeClient())}
        />
        <PhoneVerificationCard
          verifiedPhone={user.phoneVerifiedAt ? user.phone : null}
          configured={isPhoneVerificationConfigured()}
        />
        {hasPassword && (
          <TwoFactorCard
            initialEnabled={Boolean(user.twoFactorEnabledAt)}
            configured={isTwoFactorConfigured()}
          />
        )}
        <Suspense>
          <SignInMethodsCard
            hasPassword={hasPassword}
            identities={identities}
            providers={enabledSocialProviders()}
          />
        </Suspense>
        <SecuritySessionsCard />
        <PrivacyDataCard hasPassword={hasPassword} />
      </div>
    </div>
  );
}
