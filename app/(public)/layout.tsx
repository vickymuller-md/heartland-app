import { Masthead } from "@/components/landing/masthead";
import { Colophon } from "@/components/landing/colophon";

/**
 * Public route-group layout — shared masthead + colophon for pages
 * that live outside the auth gate (request-access, future marketing pages).
 */
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="bg-terminal font-editorial text-cool antialiased selection:bg-alert/40 selection:text-cool">
      <Masthead />
      <main>{children}</main>
      <Colophon />
    </div>
  );
}
