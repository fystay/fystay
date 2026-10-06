import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { withHostScope } from "@/lib/pms/hostScopedPrisma";
import { getPmsAdapter } from "@/lib/pms/registry";
import { parseProvider } from "@/lib/pms/routeHelpers";
import { encryptPmsCredentials } from "@/lib/pms/crypto";
import { SITE_URL } from "@/lib/seo";
import { withApiErrorHandling } from "@/lib/apiError";

/**
 * The OAuth2 redirect target every provider's consent screen sends the
 * host back to. Verifies `state` matches what /connect issued (stashed on
 * the pending PmsConnection row - see that route's own comment) before
 * trusting the authorization `code` at all, then exchanges it for real
 * credentials and marks the connection CONNECTED. Redirects back to the
 * integrations page either way (with a query flag on failure) rather than
 * returning raw JSON, since this URL is only ever hit by a full-page
 * browser redirect, never fetch().
 */
async function getHandler(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerParam } = await params;
  const url = new URL(request.url);
  const redirectTarget = new URL("/host/integrations", SITE_URL);

  const session = await auth();
  if (!session?.user || session.user.role !== "HOST") {
    redirectTarget.searchParams.set("pms_error", "unauthorized");
    return NextResponse.redirect(redirectTarget);
  }

  const provider = parseProvider(providerParam);
  if (!provider) {
    redirectTarget.searchParams.set("pms_error", "unknown_provider");
    return NextResponse.redirect(redirectTarget);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const providerErrorParam = url.searchParams.get("error");
  if (providerErrorParam) {
    redirectTarget.searchParams.set("pms_error", providerErrorParam);
    return NextResponse.redirect(redirectTarget);
  }
  if (!code || !state) {
    redirectTarget.searchParams.set("pms_error", "missing_code");
    return NextResponse.redirect(redirectTarget);
  }

  const connection = await withHostScope(session.user.id, (tx) =>
    tx.pmsConnection.findUnique({
      where: { hostId_provider: { hostId: session.user.id, provider } },
    }),
  );
  if (!connection || connection.externalPropertyId !== state) {
    redirectTarget.searchParams.set("pms_error", "invalid_state");
    return NextResponse.redirect(redirectTarget);
  }

  const adapter = getPmsAdapter(provider);
  if (!adapter.exchangeCodeForCredentials) {
    redirectTarget.searchParams.set("pms_error", "unsupported");
    return NextResponse.redirect(redirectTarget);
  }

  try {
    const redirectUri = `${SITE_URL}/api/host/pms/connections/${provider.toLowerCase()}/callback`;
    const { credentials, expiresAt } = await adapter.exchangeCodeForCredentials({ code, redirectUri });
    // Plain client, not withHostScope: connection.id was already resolved
    // and authorized above via the RLS-scoped read - this write never runs
    // on a client-supplied id, only one we just proved belongs to this
    // host. Keeping it off withHostScope means the network call above
    // never holds a Postgres transaction open.
    await prisma.pmsConnection.update({
      where: { id: connection.id },
      data: {
        status: "CONNECTED",
        credentialsCiphertext: encryptPmsCredentials(credentials),
        tokenExpiresAt: expiresAt,
        connectedAt: new Date(),
        disconnectedAt: null,
        // Clear the state value now that the round trip is done - the
        // host picks a real property next (see the properties route),
        // which sets this to a genuine PMS property id.
        externalPropertyId: null,
      },
    });
  } catch (error) {
    console.error(`PMS OAuth callback failed for ${provider}:`, error);
    redirectTarget.searchParams.set("pms_error", "exchange_failed");
    return NextResponse.redirect(redirectTarget);
  }

  redirectTarget.searchParams.set("pms_connected", provider);
  return NextResponse.redirect(redirectTarget);
}

export const GET = withApiErrorHandling(getHandler);
