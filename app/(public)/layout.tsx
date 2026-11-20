import { Masthead } from "@heartland/ui";
import { Colophon } from "@/components/landing/colophon";

/**
 * Public route-group layout — shared masthead + colophon for pages
 * that live outside the auth gate (request-access, future marketing pages).
 * Keeps the shared network masthead and the App's current publication footer.
 * The shared package's historical Toolkit footer must not override App releases.
 */
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="interface-masthead [&>header>div]:flex-wrap [&>header>div]:gap-3 [&>header>div>div>a]:inline-flex [&>header_a]:min-h-11 [&>header_nav]:flex-wrap bg-terminal font-editorial text-cool antialiased selection:bg-primary/20 selection:text-cool">
      <a href="#main-content" className="sr-only z-50 rounded bg-white px-4 py-3 font-semibold text-slate-950 focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to main content</a>
      <Masthead
        currentSite="app"
        navItems={[
          { label: "The Protocol", href: "/about" },
          {
            label: "Research",
            href: "https://doi.org/10.5281/zenodo.23076249",
            external: true,
          },
        ]}
        secondaryCta={{ label: "Sign in", href: "/login" }}
        cta={{ label: "Try sandbox", href: "/sandbox" }}
      />
      <main id="main-content" tabIndex={-1} className="workspace-content mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>
      <Colophon />
    </div>
  );
}
