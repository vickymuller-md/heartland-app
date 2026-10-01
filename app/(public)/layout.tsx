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
    <div className="bg-terminal font-editorial text-cool antialiased selection:bg-alert/40 selection:text-cool">
      <Masthead
        currentSite="app"
        navItems={[
          { label: "The Protocol", href: "/about" },
          { label: "Try sandbox", href: "/register?mode=tester" },
          {
            label: "Research",
            href: "https://doi.org/10.5281/zenodo.23076249",
            external: true,
          },
        ]}
        cta={{ label: "Sign in", href: "/login" }}
      />
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>
      <Colophon />
    </div>
  );
}
