// The client receives only public playback decisions, never reviewer identities
// or full evidence. The build verifies this projection against the full release.
import playback from './static-audio-playback.generated.json';
import type { AudioReleaseReason } from './static-audio-release-schema';

/** Fail closed per recording. No automatic synthesis or approval inference. */
export interface StaticAudioPlaybackPolicy {
  canPlay: boolean;
  reason: AudioReleaseReason;
  message: string;
  url?: string;
}

export function staticAudioPlaybackPolicy(locale: 'en' | 'es' = 'en', assetPath?: string): StaticAudioPlaybackPolicy {
  const entries: { path: string; locale: string; canPlay: boolean; reason: string; url?: string }[] = playback.clips;
  const matches = entries.filter(entry => `/outreach-audio/${entry.path}` === assetPath);
  const entry = matches.length === 1 ? matches[0] : undefined;
  const reason: AudioReleaseReason = !assetPath ? 'review_pending'
    : !entry ? 'unknown_asset'
      : entry.locale !== locale ? 'locale_mismatch' : entry.reason as AudioReleaseReason;
  const canPlay = reason === 'approved' && entry?.canPlay === true &&
    /^\/outreach-audio\/releases\/[a-f0-9]{64}\.mp3$/.test(entry.url ?? '');
  const decision = canPlay ? { canPlay: true, reason, url: entry!.url } : { canPlay: false, reason };
  return {
    ...decision,
    message: locale === 'es'
      ? 'Los clips pregrabados sin revisión completa permanecen pausados. Solo se reproduce un clip si su archivo y guion tienen las revisiones requeridas. La simulación sigue disponible por texto.'
      : 'Pre-recorded clips without complete review remain paused. A clip plays only when its exact recording and script have the required reviews. The simulation remains available in text.',
  };
}
