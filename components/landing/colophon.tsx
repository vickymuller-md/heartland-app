import Link from "next/link";
import { HeartLineMark } from "./medical-cross";

/**
 * Footer — uncluttered, generous padding. No literal signature block,
 * no "end of chart", just a clean restatement of brand and links.
 */
export function Colophon() {
  return (
    <footer className="border-t border-grid bg-terminal">
      <div className="mx-auto max-w-[1200px] px-6 py-16">
        <div className="grid grid-cols-1 gap-12 md:grid-cols-12">
          <div className="md:col-span-5">
            <Link href="/" className="inline-flex items-center gap-2.5">
              <HeartLineMark className="h-7 w-7 text-alert" />
              <span className="font-editorial text-[18px] font-semibold tracking-tight text-cool">
                Heartland
              </span>
            </Link>
            <p className="mt-4 max-w-md font-editorial text-[14.5px] leading-relaxed text-cool/70">
              Heart failure Evidence-based Access in Rural Treatment, Linking
              Advanced Network Delivery — a peer-reviewed implementation
              framework and its companion clinical implementation toolkit.
            </p>
            <p className="mt-6 font-editorial text-[12.5px] leading-relaxed text-stone">
              Built by Vicky Muller Ferreira, MD. For licensed clinicians
              only. This release does not establish FDA clearance or
              authorization and does not resolve medical-device classification.
              It does not replace clinical judgment or institutional policy.
              Public routes use synthetic data; authenticated workspaces remain
              controlled evaluation only. Real PHI is not authorized until
              release gates are approved.
            </p>
          </div>

          <FooterBlock title="Research">
            <FooterLink href="https://doi.org/10.7759/cureus.104817" external>
              Cureus article (PMID 41948265)
            </FooterLink>
            <FooterLink
              href="https://doi.org/10.5281/zenodo.18566403"
              external
            >
              Zenodo deposit
            </FooterLink>
            <FooterLink href="https://doi.org/10.17605/OSF.IO/YUSGH" external>
              OSF deposit
            </FooterLink>
            <FooterLink href="https://www.medrxiv.org/" external>
              medRxiv preprints
            </FooterLink>
          </FooterBlock>

          <FooterBlock title="Platform">
            <FooterLink href="/request-access">Request access</FooterLink>
            <FooterLink href="/login">Sign in</FooterLink>
            <FooterLink href="/about">About the protocol</FooterLink>
            <FooterLink
              href="https://orcid.org/0009-0009-1099-5690"
              external
            >
              ORCID profile
            </FooterLink>
          </FooterBlock>

          <FooterBlock title="Contact">
            <FooterLink href="mailto:vickymuller@heartlandprotocol.org">
              vickymuller@heartlandprotocol.org
            </FooterLink>
            <li className="font-editorial text-[14.5px] text-cool/85">
              Vicky Muller Ferreira,{" "}
              <span className="text-stone">MD</span>
            </li>
          </FooterBlock>
        </div>

        <div className="mt-14 flex flex-col gap-3 border-t border-grid pt-6 font-editorial text-[12.5px] text-stone md:flex-row md:items-center md:justify-between">
          <p>© 2026 Vicky Muller Ferreira, MD · Released under MIT</p>
          <p>HEARTLAND App v1.1.0 · open source</p>
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
    <div className="md:col-span-2 lg:col-span-2">
      <p className="mb-4 font-editorial text-[12.5px] uppercase tracking-[0.18em] text-cool">
        {title}
      </p>
      <ul className="space-y-3 font-editorial text-[14.5px]">{children}</ul>
    </div>
  );
}

function FooterLink({
  href,
  children,
  external,
}: {
  href: string;
  children: React.ReactNode;
  external?: boolean;
}) {
  const externalProps = external
    ? { target: "_blank", rel: "noopener noreferrer" }
    : {};
  return (
    <li>
      <Link
        href={href}
        {...externalProps}
        className="inline-flex items-baseline gap-1 text-cool/80 transition-colors hover:text-alert"
      >
        {children}
        {external && (
          <span className="text-[11px] text-stone" aria-hidden>
            ↗
          </span>
        )}
      </Link>
    </li>
  );
}
