import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Route classifications for role-based routing
const PUBLIC_PREFIXES = [
  "/login",
  "/register",
  "/forgot-password",
  "/update-password",
  "/confirm",
  "/consent",
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
  "/alerts",
  "/invite",
  "/titration-worklist",
  "/discharge",
  "/comorbidity-manager",
  "/quality-metrics",
  "/reports",
];

const PATIENT_PREFIXES = [
  "/today",
  "/plan",
  "/privacy",
  "/medications",
  "/education",
  "/profile",
  "/history",
  "/link-provider",
];

function isPublicRoute(path: string): boolean {
  if (PUBLIC_EXACT.has(path)) return true;
  return PUBLIC_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

function isStaticRoute(path: string): boolean {
  // Static assets, API routes, and Next.js internals
  if (
    STATIC_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    )
  ) return true;
  // Static file extensions
  if (/\.(svg|png|jpg|jpeg|gif|ico|css|js|woff2?)$/.test(path)) return true;
  return false;
}

function isProviderRoute(path: string): boolean {
  return PROVIDER_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

function isPatientRoute(path: string): boolean {
  return PATIENT_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
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

  // 2. Verify the access token before trusting identity or authorization data.
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (claimsError || !claims?.sub) {
    if (isPublicRoute(path)) return supabaseResponse;

    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Authenticated HTML and RSC payloads can contain PHI. Never let a browser,
  // shared proxy, or deployment CDN persist them.
  supabaseResponse.headers.set(
    "Cache-Control",
    "private, no-store, max-age=0, must-revalidate",
  );
  supabaseResponse.headers.set("Pragma", "no-cache");

  // Public educational/auth pages contain no PHI. Consent itself must remain
  // reachable so an invited user can explicitly accept it.
  if (isPublicRoute(path) && path !== "/" && path !== "/consent") {
    return supabaseResponse;
  }

  // Database profile is authoritative. A JWT claim can be stale after an
  // administrative role change, while user metadata is account-editable.
  const [{ data: profile }, { data: consent }] = await Promise.all([
    supabase
      .from("profiles")
      .select("role")
      .eq("id", claims.sub)
      .maybeSingle(),
    supabase
      .from("consents")
      .select("id")
      .eq("user_id", claims.sub)
      .eq("consent_type", "registration")
      .eq("consent_version", "v1.0")
      .eq("accepted", true)
      .limit(1)
      .maybeSingle(),
  ]);

  const role = profile?.role;
  if (role !== "provider" && role !== "patient") {
    const url = request.nextUrl.clone();
    url.pathname = "/error";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (path === "/consent") {
    if (!consent) return supabaseResponse;

    const url = request.nextUrl.clone();
    url.pathname = role === "provider" ? "/dashboard" : "/today";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // No clinical route is reachable before the current consent is accepted.
  if (!consent) {
    const url = request.nextUrl.clone();
    url.pathname = "/consent";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // 3. Root path is public (landing) for anonymous visitors, but authenticated
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

  // 4. Cross-role access blocking
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

  // 5. Authenticated user on allowed route -- pass through with refreshed cookies
  return supabaseResponse;
}
