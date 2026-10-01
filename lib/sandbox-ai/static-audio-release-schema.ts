import { z } from 'zod';

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const scope = z.literal('synthetic_sandbox_only');
const locale = z.enum(['en', 'es']);
export const REVIEW_ROLES = {
  clinical: 'licensed_clinician', linguistic: 'language_reviewer',
  listening: 'audio_reviewer', activation: 'release_owner',
} as const;
const decisionSchema = z.object({
  dimension: z.enum(['clinical', 'linguistic', 'listening', 'activation']),
  state: z.enum(['approved', 'rejected', 'revoked']),
  reviewer: z.string().trim().min(1),
  role: z.enum(['licensed_clinician', 'language_reviewer', 'audio_reviewer', 'release_owner']),
  reviewedAt: z.string().datetime({ offset: true }),
  evidenceRef: z.string().regex(/^[a-f0-9]{64}\.json$/),
  evidenceSha256: sha256,
  humanReviewed: z.literal(true),
  sourceSha256: sha256,
  audioSha256: sha256,
  locale,
  scope,
}).strict();

export const audioDecisionEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('audio_review_decision'),
  decision: decisionSchema.omit({ evidenceRef: true, evidenceSha256: true }),
}).strict();

export const audioReleaseSchema = z.object({
  schemaVersion: z.literal(1),
  scope,
  evidence: z.object({
    kind: z.literal('local_asr_and_decode_not_human_approval'),
    sha256,
    file: z.string().regex(/^[a-z0-9-]+\.jsonl$/),
    engine: z.string().min(1),
    model: z.string().min(1),
    revision: z.string().min(1),
    humanListening: z.literal(false),
  }).strict(),
  blockedAudio: z.array(z.object({ audioSha256: sha256, reason: z.enum(['source_mismatch', 'revoked']) }).strict()),
  clips: z.array(z.object({
    path: z.string().regex(/^(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.mp3$/),
    locale,
    sourceSha256: sha256,
    audioSha256: sha256,
    observedAt: z.string().datetime({ offset: true }),
    duration: z.number().positive(),
    provenance: z.enum(['historical_unreceipted', 'generation_receipt']),
    technical: z.object({
      decoded: z.literal(true),
      evidenceSha256: sha256,
      asrFinding: z.enum(['source_mismatch', 'uncertain', 'review_pending', 'reconciled']),
    }).strict(),
    decisions: z.object({
      clinical: decisionSchema.nullable(),
      linguistic: decisionSchema.nullable(),
      listening: decisionSchema.nullable(),
      activation: decisionSchema.nullable(),
    }).strict(),
  }).strict()),
}).strict();

export type AudioRelease = z.infer<typeof audioReleaseSchema>;
export type AudioReleaseClip = AudioRelease['clips'][number];
export type AudioReleaseReason = 'approved' | 'unknown_asset' | 'locale_mismatch' |
  'source_mismatch' | 'revoked' | 'review_pending' | 'stale_decision' | 'invalid_release';

/** Decisions are evidence records, never inferred from ASR, a receipt or file presence. */
export function audioReleaseDecision(release: AudioRelease, path: string, locale: 'en' | 'es'):
  { canPlay: true; reason: 'approved'; url: string } | { canPlay: false; reason: AudioReleaseReason } {
  const matches = release.clips.filter((clip) => `/outreach-audio/${clip.path}` === path);
  if (matches.length !== 1) return { canPlay: false, reason: 'unknown_asset' };
  const clip = matches[0];
  if (clip.locale !== locale) return { canPlay: false, reason: 'locale_mismatch' };
  const blocked = release.blockedAudio.find((entry) => entry.audioSha256 === clip.audioSha256);
  if (blocked) return { canPlay: false, reason: blocked.reason };
  if (clip.technical.asrFinding === 'source_mismatch') return { canPlay: false, reason: 'source_mismatch' };
  for (const [kind, decision] of Object.entries(clip.decisions)) {
    if (!decision || decision.state !== 'approved') return { canPlay: false, reason: decision?.state === 'revoked' ? 'revoked' : 'review_pending' };
    if (decision.dimension !== kind || decision.role !== REVIEW_ROLES[kind as keyof typeof REVIEW_ROLES] ||
      decision.sourceSha256 !== clip.sourceSha256 || decision.audioSha256 !== clip.audioSha256 ||
      decision.scope !== release.scope || decision.locale !== clip.locale) return { canPlay: false, reason: 'stale_decision' };
  }
  if (clip.technical.asrFinding !== 'reconciled') return { canPlay: false, reason: 'review_pending' };
  return { canPlay: true, reason: 'approved', url: `/outreach-audio/releases/${clip.audioSha256}.mp3` };
}
