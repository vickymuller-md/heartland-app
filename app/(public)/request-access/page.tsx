import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { RequestAccessForm } from "@/components/landing/request-access-form";

export const metadata: Metadata = {
  title: "Request Professional Access · Heartland",
  description:
    "Licensed healthcare professionals and implementation researchers may request access to the HEARTLAND Protocol clinical decision-support toolkit.",
};

export default async function RequestAccessPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <article className="bg-terminal">
      <div className="mx-auto max-w-[1200px] px-6 pb-24 pt-16 md:pb-32 md:pt-24">
        <div className="grid grid-cols-1 gap-12 md:grid-cols-12 md:gap-16">
          <header className="md:col-span-5">
            <p className="font-editorial text-[12.5px] uppercase tracking-[0.18em] text-alert">
              Controlled access
            </p>
            <h1 className="mt-5 text-[clamp(2.2rem,4.6vw,3.5rem)] font-editorial font-semibold leading-[1.05] tracking-[-0.02em] text-cool">
              Request{" "}
              <span className="font-display italic font-normal text-alert">
                professional
              </span>{" "}
              access.
            </h1>
            <p className="mt-6 max-w-md font-editorial text-[15.5px] leading-relaxed text-cool/75">
              Access is extended to practicing clinicians and implementation
              researchers. Submissions are reviewed against the invitation
              ledger, and most approved requests receive a single-use
              registration code within seven business days.
            </p>

            <ul className="mt-10 space-y-3 border-t border-grid pt-6 font-editorial text-[14px] text-cool/80">
              {[
                "Fields marked with an asterisk are required.",
                "NPI is optional — providing it speeds verification.",
                "No patient information belongs on this form, ever.",
              ].map((t) => (
                <li key={t} className="flex items-start gap-3">
                  <span className="mt-[0.6em] inline-block h-1.5 w-1.5 flex-none rounded-full bg-alert" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>

            <p className="mt-10 font-editorial text-[13.5px] text-stone">
              Already approved?{" "}
              <Link
                href="/login"
                className="text-cool underline decoration-grid underline-offset-4 hover:decoration-alert hover:text-alert"
              >
                Sign in →
              </Link>
            </p>
          </header>

          <div className="md:col-span-7">
            <div className="rounded-3xl border border-grid bg-panel p-6 md:p-10">
              <RequestAccessForm />
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
