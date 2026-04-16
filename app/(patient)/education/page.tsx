/**
 * Education Page -- Server Component
 *
 * Shows education modules filtered by patient's facility tier.
 * Track assignment determines content variant (Track A vs Track B).
 * Requirements: EDUC-01, EDUC-02, EDUC-04, RMON-06
 */

import { createClient } from '@/lib/supabase/server';
import { EDUCATION_DOMAINS } from '@/lib/education/constants';
import { getEducationProgress } from '@/lib/education/queries';
import { EducationModuleList } from './_components/education-module-list';
import { TrackBadge } from './_components/track-badge';
import { redirect } from 'next/navigation';

export default async function EducationPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  // Fetch patient profile for track assignment and facility tier
  const { data: patient } = await supabase
    .from('patients')
    .select('track_assignment, facility_tier')
    .eq('id', user.id)
    .single();

  // Default track_assignment to 'track_b' if null (per RMON-06)
  const trackAssignment = patient?.track_assignment ?? 'track_b';
  // Default facility_tier to 1 if null
  const facilityTier = patient?.facility_tier ?? 1;

  // Filter domains by tier: core always shown, extended only at tier >= 2
  const availableDomains = EDUCATION_DOMAINS.filter(
    (d) => d.tier === 'core' || facilityTier >= 2
  );

  // Fetch education progress
  const progress = await getEducationProgress(supabase, user.id);

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold text-gray-900">Learn</h1>
      <TrackBadge trackAssignment={trackAssignment} />
      <EducationModuleList
        domains={availableDomains}
        trackAssignment={trackAssignment}
        progress={progress}
      />
    </div>
  );
}
