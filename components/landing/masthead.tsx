import Link from "next/link";
import { HeartLineMark } from "./medical-cross";

/**
 * Masthead — soft, generous nav bar. Wordmark on the left, light meta
 * links in the middle, primary actions on the right. Reads warm and
 * confident; nothing terminal/clinical/literal.
 */
export function Masthead() {
  return (
    <header className="border-b border-grid bg-terminal/85 backdrop-blur supports-[backdrop-filter]:bg-terminal/70">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-8 px-6 py-5">
        <Link href="/" className="group flex items-center gap-2.5">
          <HeartLineMark className="h-7 w-7 text-alert transition-transform group-hover:scale-105" />
          <span className="font-editorial text-[18px] font-semibold tracking-tight text-cool">
            Heartland
          </span>
        </Link>

        <nav className="hidden items-center gap-8 font-editorial text-[14px] text-cool/80 md:flex">
          <Link href="/about" className="hover:text-alert">
            The Protocol
          </Link>
          <a
            href="https://doi.org/10.5281/zenodo.18566403"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-alert"
          >
            Research
          </a>
          <Link href="/login" className="hover:text-alert">
            Sign in
          </Link>
        </nav>

        <Link
          href="/request-access"
          className="group inline-flex items-center gap-2 rounded-full bg-cool px-5 py-2.5 font-editorial text-[13.5px] font-medium text-terminal transition-colors hover:bg-alert hover:text-cool"
        >
          Request access
          <span className="transition-transform group-hover:translate-x-0.5">
            →
          </span>
        </Link>
      </div>
    </header>
  );
}
