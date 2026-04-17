import { Masthead, Colophon } from "@heartland/ui";

/**
 * Public route-group layout — shared masthead + colophon for pages
 * that live outside the auth gate (request-access, future marketing pages).
 * Consumes shared @heartland/ui components to stay in sync with the
 * other HEARTLAND network sites.
 */
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="bg-terminal font-editorial text-cool antialiased selection:bg-alert/40 selection:text-cool">
      <Masthead
        currentSite="app"
        navItems={[
          { label: "The Protocol", href: "/about" },
          {
            label: "Research",
            href: "https://doi.org/10.5281/zenodo.18566403",
            external: true,
          },
          { label: "Sign in", href: "/login" },
        ]}
        cta={{ label: "Request access", href: "/request-access" }}
      />
      <main>{children}</main>
      <Colophon
        currentSite="app"
        version="v1.0.2"
        extraBlocks={[
          {
            title: "Platform",
            links: [
              { label: "Request access", href: "/request-access" },
              { label: "Sign in", href: "/login" },
              { label: "About the protocol", href: "/about" },
            ],
          },
        ]}
      />
    </div>
  );
}
