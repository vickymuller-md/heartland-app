import Link from "next/link";
import { HeartLineMark } from "./medical-cross";
import { APP_VERSION } from "@/lib/app-version";
import { HEARTLAND_NETWORK } from "@heartland/ui";

/**
 * Footer — uncluttered, generous padding. No literal signature block,
 * no "end of chart", just a clean restatement of brand and links.
 */
export function Colophon() {
  return (
    <footer className="border-t border-grid bg-terminal">
      <div className="mx-auto max-w-[1200px] px-6 py-16">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-10">
          <div className="min-w-0">
            <Link href="/" className="inline-flex min-h-11 items-center gap-2.5">
              <HeartLineMark className="h-7 w-7 text-alert" />
              <span className="font-editorial text-lg font-semibold tracking-tight text-cool">
                Heartland · App
              </span>
            </Link>
            <p className="mt-4 max-w-md font-editorial text-base leading-relaxed text-cool/80">
              Heart failure Evidence-based Access in Rural Treatment, Linking
              Advanced Network Delivery. An educational implementation companion
              based on the published protocol, with synthetic demonstrations.
            </p>
            <p className="mt-6 font-editorial text-sm leading-relaxed text-stone">
              Built by Vicky Muller Ferreira, MD. For licensed clinicians
              only. This release does not establish FDA clearance or
              authorization and does not resolve medical-device classification.
              It does not replace clinical judgment or institutional policy.
              Public routes use synthetic data; authenticated workspaces remain
              controlled evaluation only. Real PHI and unsupervised clinical use
              are not authorized until release gates are approved.
            </p>
          </div>

          <FooterBlock title="Research">
            <FooterLink href="https://doi.org/10.7759/cureus.104817" external>
              Peer-reviewed protocol article
            </FooterLink>
            <FooterLink
              href="https://doi.org/10.5281/zenodo.19101219"
              external
            >
              Implementation Toolkit · v3.3
            </FooterLink>
            <FooterLink href="https://doi.org/10.5281/zenodo.22233054" external>
              App software archive · {APP_VERSION}
            </FooterLink>
            <FooterLink href="https://doi.org/10.17605/OSF.IO/YUSGH" external>
              OSF deposit
            </FooterLink>
            <FooterLink href="https://orcid.org/0009-0009-1099-5690" external>
              ORCID profile
            </FooterLink>
          </FooterBlock>

          <FooterBlock title="Platform">
            <FooterLink href="/sandbox">Open Evidence Lab</FooterLink>
            <FooterLink href="/register?mode=tester">Create tester account</FooterLink>
            <FooterLink href="/request-access">Request evaluation access</FooterLink>
            <FooterLink href="/login">Sign in</FooterLink>
            <FooterLink href="/about">About the protocol</FooterLink>
            <FooterLink
              href="https://archive.softwareheritage.org/swh:1:snp:3e39be4952047172a2c1a131c2965bd580a6dc69/"
              external
            >
              Software Heritage · historical snapshot
            </FooterLink>
            <li className="text-sm leading-relaxed text-stone">
              This historical snapshot does not archive the local candidate
              improvements described above.
            </li>
          </FooterBlock>

          <nav aria-label="HEARTLAND network" className="min-w-0">
            <FooterBlock title="Network">
              {HEARTLAND_NETWORK.map((entry) => (
                <FooterLink key={entry.id} href={entry.url} external={entry.id !== "app"} current={entry.id === "app"}>
                  {entry.shortLabel}
                </FooterLink>
              ))}
            </FooterBlock>
          </nav>
        </div>

        <div className="mt-14 flex flex-col flex-wrap gap-3 border-t border-grid pt-6 font-editorial text-sm leading-relaxed text-stone md:flex-row md:items-center md:justify-between">
          <p>© 2026 Vicky Muller Ferreira, MD · App source under MIT</p>
          <p>HEARTLAND App {APP_VERSION} · open source</p>
        </div>
      </div>
    </footer>
  );
}

function FooterBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <h3 className="mb-4 font-editorial text-sm uppercase tracking-[0.14em] text-cool">
        {title}
      </h3>
      <ul className="space-y-2 font-editorial text-base leading-relaxed">{children}</ul>
    </div>
  );
}

function FooterLink({
  href,
  children,
  external,
  current,
}: {
  href: string;
  children: React.ReactNode;
  external?: boolean;
  current?: boolean;
}) {
  const externalProps = external
    ? { target: "_blank", rel: "noopener noreferrer" }
    : {};
  return (
    <li>
      <Link
        href={href}
        {...externalProps}
        aria-current={current ? "page" : undefined}
        className="inline-flex min-h-11 max-w-full items-center gap-1 py-2 text-cool/80 transition-colors hover:text-alert"
      >
        {children}
        {external && (
          <span className="shrink-0 text-sm text-stone" aria-hidden>
            ↗
          </span>
        )}
      </Link>
    </li>
  );
}
