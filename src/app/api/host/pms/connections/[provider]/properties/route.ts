import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { withHostScope } from "@/lib/pms/hostScopedPrisma";
import { getPmsAdapter } from "@/lib/pms/registry";
import { parseProvider } from "@/lib/pms/routeHelpers";
import { getValidCredentials } from "@/lib/pms/sync";
import { pmsErrorForHost } from "@/lib/pms/types";
import { withApiErrorHandling } from "@/lib/apiError";

// The RLS-scoped read that proves a connection belongs to this host - every
// following step (credential refresh, the actual adapter call) uses the
// plain client scoped to connection.id, not withHostScope, since those can
// involve a slow outbound network call that shouldn't hold a Postgres
// transaction open.
async function loadConnectedConnection(hostId: string, providerParam: string) {
  const provider = parseProvider(providerParam);
  if (!provider) return { ok: false, error: NextResponse.json({ error: "Unknown provider" }, { status: 400 }) } as const;

  const connection = await withHostScope(hostId, (tx) =>
    tx.pmsConnection.findUnique({ where: { hostId_provider: { hostId, provider } } }),
  );
  if (!connection || !connection.credentialsCiphertext) {
    return { ok: false, error: NextResponse.json({ error: "Not connected" }, { status: 404 }) } as const;
  }
  return { ok: true, connection, provider } as const;
}

/** Lists the properties this connection's authenticated account can see - the host picks one to import from next (see POST below). Most hosts only manage one property on the PMS side, but a multi-property account still needs to choose. */
async function getHandler(_request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerParam } = await params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const loaded = await loadConnectedConnection(session.user.id, providerParam);
  if (!loaded.ok) return loaded.error;
  const { connection, provider } = loaded;

  const adapter = getPmsAdapter(provider);
  try {
    const credentials = await getValidCredentials(prisma, connection, adapter);
    if (!credentials) return NextResponse.json({ error: "Not connected" }, { status: 404 });
    const properties = await adapter.listProperties(credentials);
    return NextResponse.json({ properties });
  } catch (error) {
    const message = pmsErrorForHost(error, "We couldn't load your properties. Please try again.");
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

const selectPropertySchema = z.object({
  externalPropertyId: z.string().min(1),
  name: z.string().min(1),
});

/** Sets which PMS property this connection imports from - required before rooms can be listed/mapped, since every other adapter call is scoped to one property. */
async function postHandler(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerParam } = await params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const loaded = await loadConnectedConnection(session.user.id, providerParam);
  if (!loaded.ok) return loaded.error;
  const { connection } = loaded;

  const body = await request.json().catch(() => null);
  const parsed = selectPropertySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  await withHostScope(session.user.id, (tx) =>
    tx.pmsConnection.update({
      where: { id: connection.id },
      data: { externalPropertyId: parsed.data.externalPropertyId, externalPropertyName: parsed.data.name },
    }),
  );

  return NextResponse.json({ selected: true });
}

export const GET = withApiErrorHandling(getHandler);
export const POST = withApiErrorHandling(postHandler);
