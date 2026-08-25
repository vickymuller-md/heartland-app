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
          { label: "Try sandbox", href: "/register?mode=tester" },
          {
            label: "Research",
            href: "https://doi.org/10.5281/zenodo.19101219",
            external: true,
          },
        ]}
        cta={{ label: "Sign in", href: "/login" }}
      />
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>
      <Colophon
        currentSite="app"
        version="v1.2.0"
        legal={
          <>
            Built by Vicky Muller Ferreira, MD. Public tools and the sandbox use synthetic data; tester registration may collect account contact information. Authenticated workspaces remain controlled evaluation only. Real PHI and unsupervised clinical use are not authorized until organizational release gates are approved.
          </>
        }
        extraBlocks={[
          {
            title: "Platform",
            links: [
              { label: "Try sandbox", href: "/register?mode=tester" },
              { label: "Request clinical access", href: "/request-access" },
              { label: "Sign in", href: "/login" },
              { label: "About the protocol", href: "/about" },
            ],
          },
        ]}
      />
    </div>
  );
}
