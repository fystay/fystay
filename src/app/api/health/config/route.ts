import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { productionReadiness } from "@/lib/configReadiness";
import { prisma } from "@/lib/prisma";
import { demoAccountWhere } from "@/lib/demoContent";

/**
 * Which production settings are missing - names and consequences only,
 * never a value. Protected by CRON_SECRET (send `Authorization: Bearer
 * <CRON_SECRET>`), since even the list of what's unset is nobody else's
 * business. Answers 503 while anything blocking is missing, so an uptime
 * monitor pointed here alerts until it's fixed.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const summary = await productionReadiness(() => prisma.user.count({ where: demoAccountWhere }));
  return NextResponse.json(summary, { status: summary.ready ? 200 : 503 });
}
