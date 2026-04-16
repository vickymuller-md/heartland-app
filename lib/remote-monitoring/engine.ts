/**
 * Remote Monitoring — Track Assignment Engine
 *
 * Pure function covering all 8 combinations of 3 boolean inputs.
 * Protocol v3.3 Module 5, Table 4.
 *
 * Logic:
 *   smartphone + apps -> Track A (Digital) regardless of telephone
 *   smartphone + no apps + telephone -> Hybrid
 *   smartphone + no apps + no telephone -> Hybrid (smartphone for video when possible)
 *   no smartphone + telephone -> Track B (Analog)
 *   no smartphone + no telephone -> Track B with CHW support note
 */

import type { TrackAssessment, TrackRecommendation } from './types';

export function assignTrack(assessment: TrackAssessment): TrackRecommendation {
  const { smartphoneConnectivity, comfortableWithApps, reliableTelephone } =
    assessment;

  // Smartphone + comfortable with apps -> Track A (Digital)
  if (smartphoneConnectivity && comfortableWithApps) {
    return {
      track: 'track-a',
      label: 'Track A (Digital)',
      rationale: reliableTelephone
        ? 'Patient has smartphone connectivity, is comfortable with apps, and has reliable telephone access. Full digital monitoring with app-based daily entry, automated alerts, and video visits.'
        : 'Patient has smartphone connectivity and is comfortable with apps. Digital monitoring with app-based daily entry and automated alerts. Telephone backup not available but not required for Track A.',
    };
  }

  // Smartphone but not comfortable with apps
  if (smartphoneConnectivity && !comfortableWithApps) {
    return {
      track: 'hybrid',
      label: 'Hybrid (Mixed)',
      rationale: reliableTelephone
        ? 'Patient has smartphone but is not comfortable with apps. Hybrid approach: voice telephone calls for routine check-ins with smartphone available for video visits when possible.'
        : 'Patient has smartphone but is not comfortable with apps and lacks reliable telephone. Hybrid approach: smartphone for video visits when possible, with in-person or CHW follow-up for routine monitoring.',
    };
  }

  // No smartphone + telephone available
  if (!smartphoneConnectivity && reliableTelephone) {
    return {
      track: 'track-b',
      label: 'Track B (Analog)',
      rationale: 'Patient does not have smartphone connectivity but has reliable telephone access. Analog monitoring with paper diary, standard devices, voice telephone calls, and verbal report to staff.',
    };
  }

  // No smartphone + no telephone -> Track B with CHW support
  return {
    track: 'track-b',
    label: 'Track B (Analog)',
    rationale: 'Patient lacks smartphone connectivity and reliable telephone access. Analog monitoring with paper diary and standard devices. CHW or community health worker support recommended for regular in-person check-ins and data collection.',
  };
}
