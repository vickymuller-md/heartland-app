import type { MetadataRoute } from "next";

const SITE_URL = "https://app.heartlandprotocol.org";

// Public, unauthenticated routes only (kept in sync with the proxy allowlist).
const PUBLIC_ROUTES: Array<{ path: string; priority: number }> = [
  { path: "/", priority: 1 },
  { path: "/about", priority: 0.8 },
  { path: "/sandbox", priority: 0.9 },
  { path: "/risk-calculator", priority: 0.8 },
  { path: "/gdmt-pathway", priority: 0.8 },
  { path: "/titration-checklist", priority: 0.8 },
  { path: "/remote-monitoring", priority: 0.8 },
  { path: "/tier-selector", priority: 0.8 },
  { path: "/pocket-cards", priority: 0.7 },
  { path: "/guide", priority: 0.7 },
  { path: "/request-access", priority: 0.5 },
  { path: "/downtime", priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_ROUTES.map(({ path, priority }) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: "monthly",
    priority,
  }));
}
