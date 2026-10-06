import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { buildAccountDataExport } from "@/lib/accountData";
import { withApiErrorHandling } from "@/lib/apiError";

/** Self-service "download my data" - see buildAccountDataExport for exactly what's included. Returned as a downloadable file rather than inline JSON so a browser click reliably saves it. */
async function getHandler() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const data = await buildAccountDataExport(prisma, session.user.id);

  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="fystay-data-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}

export const GET = withApiErrorHandling(getHandler);
