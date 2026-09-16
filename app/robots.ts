import type { MetadataRoute } from "next";

const SITE_URL = "https://app.heartlandprotocol.org";

// Authenticated workspaces, account flows and internals are never indexable.
// Public educational tools, the sandbox and the about page are.
const DISALLOWED = [
  "/api/",
  "/dashboard",
  "/patients",
  "/alerts",
  "/invite",
  "/titration-worklist",
  "/discharge",
  "/comorbidity-manager",
  "/quality-metrics",
  "/reports",
  "/team",
  "/today",
  "/plan",
  "/privacy",
  "/medications",
  "/education",
  "/profile",
  "/history",
  "/link-provider",
  "/security",
  "/login",
  "/register",
  "/forgot-password",
  "/update-password",
  "/confirm",
  "/consent",
  "/error",
  "/~offline",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: DISALLOWED }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
