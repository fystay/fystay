import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { productionReadiness } from "@/lib/configReadiness";
import { demoAccountWhere } from "@/lib/demoContent";

/**
 * Public, unauthenticated liveness/readiness check for uptime monitors and
 * manual "is it actually up" checks - deliberately outside
 * withApiErrorHandling's try/catch-and-report pattern, since a DB failure
 * here is the expected, meaningful signal this route exists to surface,
 * not an unexpected bug to report to Sentry. Says nothing about *why* the
 * database is unreachable (no error message/stack) - just up or down -
 * since this endpoint is public and shouldn't leak infrastructure detail.
 * `config` is just "ok" or "incomplete" for the same reason; which settings
 * are missing is behind /api/health/config.
 */
export async function GET() {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: "ok",
      database: "ok",
      config: (await productionReadiness(() => prisma.user.count({ where: demoAccountWhere }))).ready ? "ok" : "incomplete",
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      {
        status: "error",
        database: "unreachable",
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
