import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Route classifications for role-based routing
const PUBLIC_PREFIXES = [
  "/login",
  "/register",
  "/forgot-password",
  "/update-password",
  "/confirm",
  "/error",
  "/about",
  "/request-access",
  // Public demo access: the educational tools are client-side, use no
  // account data and no PHI (all bundled data is synthetic), so they are
  // open for anonymous evaluation. Account workflows (dashboard, patients,
  // alerts, worklists) still require a session.
  "/risk-calculator",
  "/gdmt-pathway",
  "/titration-checklist",
  "/remote-monitoring",
  "/tier-selector",
  "/pocket-cards",
  "/tools",
  "/guide",
];

// Exactly-matched paths that are public (no session required).
// Using exact match avoids "/" inadvertently matching every route.
const PUBLIC_EXACT = new Set<string>(["/"]);

const STATIC_PREFIXES = ["/api", "/_next", "/favicon.ico"];

const PROVIDER_PREFIXES = [
  "/dashboard",
  "/patients",
  "/tools",
  "/pocket-cards",
  "/alerts",
  "/risk-calculator",
  "/gdmt-pathway",
  "/titration-checklist",
  "/remote-monitoring",
  "/tier-selector",
  "/invite",
  "/titration-worklist",
];

const PATIENT_PREFIXES = [
  "/today",
  "/medications",
  "/education",
  "/profile",
];

function isPublicRoute(path: string): boolean {
  if (PUBLIC_EXACT.has(path)) return true;
  return PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function isStaticRoute(path: string): boolean {
  // Static assets, API routes, and Next.js internals
  if (STATIC_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  // Static file extensions
  if (/\.(svg|png|jpg|jpeg|gif|ico|css|js|woff2?)$/.test(path)) return true;
  return false;
}

function isProviderRoute(path: string): boolean {
  return PROVIDER_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function isPatientRoute(path: string): boolean {
  return PATIENT_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const path = request.nextUrl.pathname;

  // 1. Static assets and API routes -- always allow through
  if (isStaticRoute(path)) {
    return supabaseResponse;
  }

  // 2. Public auth routes -- allow through (login, register, etc.)
  if (isPublicRoute(path)) {
    return supabaseResponse;
  }

  // 3. Get session (lightweight — reads from cookie, no server round-trip)
  const { data: { session } } = await supabase.auth.getSession();

  // No session -- redirect to /login
  if (!session?.user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  const user = session.user;

  // 4. Extract role from user_metadata (set at signup) or app_metadata (Auth Hook)
  const role =
    (user.app_metadata?.user_role as string) ||
    (user.user_metadata?.role as string) ||
    "patient";

  // 5. Root path is public (landing) for anonymous visitors, but authenticated
  //    users should be sent to their role-appropriate portal.
  if (path === "/") {
    const url = request.nextUrl.clone();
    if (role === "provider") {
      url.pathname = "/dashboard";
    } else if (role === "patient") {
      url.pathname = "/today";
    } else {
      url.pathname = "/login";
    }
    return NextResponse.redirect(url);
  }

  // 6. Cross-role access blocking
  if (isProviderRoute(path) && role !== "provider") {
    // Non-provider accessing provider routes -- redirect to patient portal
    const url = request.nextUrl.clone();
    url.pathname = "/today";
    return NextResponse.redirect(url);
  }

  if (isPatientRoute(path) && role !== "patient") {
    // Non-patient accessing patient routes -- redirect to provider portal
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // 7. Authenticated user on allowed route -- pass through with refreshed cookies
  return supabaseResponse;
}
