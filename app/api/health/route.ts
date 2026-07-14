import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

function validCronAuthorization(header: string | null, secret: string): boolean {
  const actual = Buffer.from(header ?? "", "utf8");
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(request: Request) {
  // Vercel cron pings this every 3 days. Require auth to prevent public probing.
  if (!process.env.CRON_SECRET) {
    console.error('[health] CRON_SECRET is not configured -- cron cannot authenticate');
    return NextResponse.json(
      { status: "error", error: "CRON_SECRET not configured" },
      { status: 503 },
    );
  }

  const authHeader = request.headers.get('authorization');
  if (!validCronAuthorization(authHeader, process.env.CRON_SECRET)) {
    return NextResponse.json({ status: "error", error: "Unauthorized" }, { status: 401 });
  }

  const { error } = await supabaseAdmin.from("profiles").select("id").limit(1);

  if (error) {
    return NextResponse.json(
      { status: "error", error: "Database unavailable" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
}
