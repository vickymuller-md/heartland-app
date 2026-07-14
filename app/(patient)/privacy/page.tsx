import { redirect } from 'next/navigation';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { ProductEventTracker } from '@/components/analytics/product-event-tracker';
import { RevokeAccessButton } from './privacy-controls';
import { signOutAllDevices } from './actions';
import { Button } from '@/components/ui/button';

interface AccessRow {
  link_id: string;
  provider_id: string;
  provider_name: string | null;
  status: string;
  linked_at: string | null;
  created_at: string;
}

export default async function PrivacyPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data, error } = await supabase.rpc('get_patient_access_history');
  const access = (data ?? []) as AccessRow[];

  return (
    <div className="space-y-5">
      <ProductEventTracker eventName="access_review" area="privacy" />
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">Privacy & access</p>
        <h1 className="text-2xl font-bold text-slate-950">Who can access your workspace</h1>
        <p className="mt-1 text-sm text-slate-600">Review provider relationships and end active access at any time.</p>
      </div>

      {error ? (
        <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-medium text-red-900">Access history could not be loaded.</div>
      ) : access.length === 0 ? (
        <div className="rounded-xl border border-dashed p-5 text-sm text-slate-600">No provider access relationship is recorded.</div>
      ) : (
        <div className="space-y-3">
          {access.map((row) => (
            <article key={row.link_id} className="rounded-xl border bg-white p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex items-center gap-2"><ShieldCheck className="size-5 text-blue-700" /><h2 className="font-semibold text-slate-950">{row.provider_name ?? 'Provider'}</h2></div>
                  <p className="mt-1 text-sm capitalize text-slate-600">Status: {row.status}</p>
                  <p className="text-xs text-slate-500">{row.linked_at ? `Linked ${new Date(row.linked_at).toLocaleDateString('en-US')}` : `Requested ${new Date(row.created_at).toLocaleDateString('en-US')}`}</p>
                </div>
                {row.status === 'active' && <RevokeAccessButton linkId={row.link_id} providerName={row.provider_name ?? 'this provider'} />}
              </div>
            </article>
          ))}
        </div>
      )}

      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-3">
          <KeyRound className="mt-0.5 size-5 text-amber-800" />
          <div>
            <h2 className="font-semibold text-amber-950">Account sessions</h2>
            <p className="mt-1 text-sm text-amber-900">If a device is lost or shared, sign out every active HEARTLAND session.</p>
            <form action={signOutAllDevices} className="mt-3">
              <Button type="submit" variant="outline" className="border-amber-400 bg-white">Sign out all devices</Button>
            </form>
          </div>
        </div>
      </section>
    </div>
  );
}
