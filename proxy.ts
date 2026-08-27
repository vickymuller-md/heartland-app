import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

// Static assets never carry a session and must be served with native range
// support (media streaming hangs when a middleware response wraps them), so
// they are excluded here; lib/supabase/proxy.ts keeps its own static-route
// allowlist as defense in depth for anything that still reaches it.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|ico|css|js|woff2|woff|mp3)$).*)",
  ],
};
