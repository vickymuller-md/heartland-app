/**
 * Education Page -- Server Component
 *
 * Shows every education module, whatever the patient's facility tier.
 * Track assignment determines content variant (Track A vs Track B).
 * Requirements: EDUC-01, EDUC-02, EDUC-04, RMON-06
 */

import { createClient } from '@/lib/supabase/server';
import { trackKeyFromAssignment } from '@/lib/education/types';
import { EDUCATION_DOMAINS } from '@/lib/education/constants';
import { getEducationProgress } from '@/lib/education/queries';
import { EducationModuleList } from './_components/education-module-list';
import { TrackBadge } from './_components/track-badge';
import { redirect } from 'next/navigation';
import { createHash } from 'node:crypto';

export default async function EducationPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  // Fetch patient profile for track assignment
  const { data: patient } = await supabase
    .from('patients')
    .select('track_assignment')
    .eq('id', user.id)
    .single();

  // Stored values are 'A' | 'B' | 'hybrid' | null; the screens use track keys (null -> Track B, RMON-06).
  const trackAssignment = trackKeyFromAssignment(patient?.track_assignment);

  // Every domain is available at every facility tier, including an unknown tier.
  const availableDomains = EDUCATION_DOMAINS;
  // Bind the rendered questions to the exact version, including long-lived tabs.
  const contentVersion = createHash('sha256').update(JSON.stringify(
    availableDomains.map(({ id, question }) => ({ id, question })),
  )).digest('hex');

  // Fetch education progress
  const progress = await getEducationProgress(supabase, user.id);

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold text-gray-900">Learn</h1>
      <TrackBadge trackAssignment={trackAssignment} />
      <EducationModuleList
        actorId={user.id}
        contentVersion={contentVersion}
        key={user.id}
        domains={availableDomains}
        trackAssignment={trackAssignment}
        progress={progress}
      />
    </div>
  );
}
