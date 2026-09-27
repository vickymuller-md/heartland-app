/**
 * Temporary quarantine of historical demo recordings.
 *
 * All 58 clips lack generation receipts; 24 sources changed without replacing
 * their audio. Keep the current transcript available, but do not play any of
 * those files until source/audio identity and content review are recorded.
 * A generation receipt alone is not clinical or linguistic approval.
 * This policy does not enable paid runtime synthesis as a substitute.
 */
export interface StaticAudioPlaybackPolicy {
  canPlay: boolean;
  reason: 'review_pending';
  message: string;
}

export function staticAudioPlaybackPolicy(locale: 'en' | 'es' = 'en'): StaticAudioPlaybackPolicy {
  return {
    canPlay: false,
    reason: 'review_pending',
    message: locale === 'es'
      ? 'El audio pregrabado está pausado mientras se verifica que coincida con el guion actual. La simulación sigue disponible por texto.'
      : 'Pre-recorded audio is paused while it is checked against the current script. The simulation remains available in text.',
  };
}
