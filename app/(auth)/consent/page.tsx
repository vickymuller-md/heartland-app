import { redirect } from "next/navigation";
import { authorize } from "@/lib/auth/authorization";
import { ConsentAcceptance } from "./consent-acceptance";

interface ConsentPageProps {
  searchParams: Promise<{ invited?: string }>;
}

export default async function ConsentPage({ searchParams }: ConsentPageProps) {
  const auth = await authorize(undefined, { requireConsent: false });
  if (!auth.authorized) redirect("/login");

  const { invited } = await searchParams;
  const nextPath = invited === "1"
    ? "/update-password"
    : auth.role === "provider"
      ? "/dashboard"
      : auth.role === "tester" ? "/sandbox" : "/today";

  return <ConsentAcceptance nextPath={nextPath} />;
}
