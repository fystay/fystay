import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { withHostScope } from "@/lib/pms/hostScopedPrisma";
import { getPmsAdapter } from "@/lib/pms/registry";
import { parseProvider } from "@/lib/pms/routeHelpers";
import { encryptPmsCredentials } from "@/lib/pms/crypto";
import { PmsAdapterError } from "@/lib/pms/types";
import { SITE_URL } from "@/lib/seo";
import { withApiErrorHandling } from "@/lib/apiError";

function callbackUrl(provider: string): string {
  return `${SITE_URL}/api/host/pms/connections/${provider.toLowerCase()}/callback`;
}

/**
 * Starts a connection. For an OAuth2 provider (Cloudbeds, SiteMinder) this
 * returns the provider's consent-screen URL for the browser to redirect
 * to - state is a random token stashed on a pending PmsConnection row
 * (status stays DISCONNECTED until the callback completes) so the
 * callback can verify the redirect wasn't forged. For an API-key provider
 * (SuperControl) the host's entered credentials are verified with one real
 * call and, if valid, stored immediately - no redirect needed.
 */
async function postHandler(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerParam } = await params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "HOST") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const provider = parseProvider(providerParam);
  if (!provider) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });

  const adapter = getPmsAdapter(provider);

  if (adapter.authMethod === "oauth2") {
    if (!adapter.getAuthorizationUrl) {
      return NextResponse.json({ error: `${provider} does not support OAuth connect` }, { status: 400 });
    }
    const state = randomBytes(24).toString("hex");
    await withHostScope(session.user.id, (tx) =>
      tx.pmsConnection.upsert({
        where: { hostId_provider: { hostId: session.user.id, provider } },
        create: { hostId: session.user.id, provider, status: "DISCONNECTED", externalPropertyId: state },
        // Stashing `state` in externalPropertyId briefly, before a real
        // property is chosen post-callback, is a deliberate reuse of an
        // existing nullable column rather than a dedicated one used only
        // for the few seconds of an OAuth round trip.
        update: { externalPropertyId: state },
      }),
    );
    let authorizationUrl: string;
    try {
      authorizationUrl = adapter.getAuthorizationUrl({ state, redirectUri: callbackUrl(provider) });
    } catch (error) {
      const message = error instanceof PmsAdapterError ? error.message : "Could not start connection";
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ authorizationUrl });
  }

  // api_key flow
  if (!adapter.verifyApiKeyCredentials) {
    return NextResponse.json({ error: `${provider} does not support API-key connect` }, { status: 400 });
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Missing credentials" }, { status: 400 });
  }

  let verification: { ok: true } | { ok: false; error: string };
  try {
    verification = await adapter.verifyApiKeyCredentials(body);
  } catch (error) {
    const message = error instanceof PmsAdapterError ? error.message : "Could not verify credentials";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  if (!verification.ok) {
    return NextResponse.json({ error: verification.error }, { status: 400 });
  }

  await withHostScope(session.user.id, (tx) =>
    tx.pmsConnection.upsert({
      where: { hostId_provider: { hostId: session.user.id, provider } },
      create: {
        hostId: session.user.id,
        provider,
        status: "CONNECTED",
        credentialsCiphertext: encryptPmsCredentials(body),
        connectedAt: new Date(),
      },
      update: {
        status: "CONNECTED",
        credentialsCiphertext: encryptPmsCredentials(body),
        connectedAt: new Date(),
        disconnectedAt: null,
      },
    }),
  );

  return NextResponse.json({ connected: true });
}

export const POST = withApiErrorHandling(postHandler);
