import { NextResponse, type NextRequest } from "next/server";
import { getNiwTractionStats } from "@/lib/reports/queries";

/**
 * GET /api/reports
 *
 * Returns the current NiwTractionData snapshot as JSON for programmatic
 * consumption (e.g., monthly report automation, external archival, or
 * NIW-petition evidence scripts). Requires the service_role key passed
 * as a Bearer token in the Authorization header; this endpoint is *not*
 * callable from a browser with only an anon session.
 *
 * Usage:
 *   curl -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
 *        https://app.heartlandprotocol.org/api/reports
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`;

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Reports endpoint is not configured on this environment." },
      { status: 503 },
    );
  }

  if (auth !== expected) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="reports"' } },
    );
  }

  try {
    const data = await getNiwTractionStats();
    return NextResponse.json(
      {
        generated_at: new Date().toISOString(),
        schema: "NiwTractionData.v1",
        data,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "Content-Type": "application/json; charset=utf-8",
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[/api/reports] failed", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
