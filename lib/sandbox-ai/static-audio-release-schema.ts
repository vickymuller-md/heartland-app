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

const reference = { evidenceRef: z.string().regex(/^[a-f0-9]{64}\.json$/), evidenceSha256: sha256 };

// A distinct, explicit authorization path for synthetic demonstrations. This
// never represents automated checks as human listening or a signed attestation.
const delegatedAuthority = z.object({
  policy: z.literal('synthetic_delegated_v1'), state: z.enum(['approved', 'revoked']),
  scope, catalogSha256: sha256, recordedAt: z.string().datetime({ offset: true }),
  reportedBy: z.string().trim().min(1), reportedClinicalReviewer: z.string().trim().min(1),
  clinicalBasis: z.literal('owner_reported_clinical_source_acceptance'),
  clinicalStatement: z.string().trim().min(1), activationStatement: z.string().trim().min(1),
  signedByClinician: z.literal(false), humanListening: z.literal(false),
  documentaryEvidenceRef: reference.evidenceRef, documentaryEvidenceSha256: sha256,
}).strict();
export const delegatedAuthorityEvidenceSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('synthetic_audio_release_authority'), authority: delegatedAuthority,
}).strict();
export const documentaryAudioEvidenceSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('delegated_automated_documentary_review'),
  catalogSha256: sha256, scope, recordedAt: z.string().datetime({ offset: true }),
  reviewer: z.string().trim().min(1), method: z.string().trim().min(1),
  humanReviewed: z.literal(false), state: z.literal('passed'),
  bilingualPairs: z.literal(27), englishOnlyDialogues: z.literal(4),
  findings: z.array(z.string().trim().min(1)).min(1), limitations: z.array(z.string().trim().min(1)).min(1),
}).strict();
const delegatedVerification = z.object({
  kind: z.literal('automated_asr_decode_verification'), state: z.enum(['passed', 'uncertain', 'failed', 'revoked']),
  scope, locale, recordedAt: z.string().datetime({ offset: true }),
  sourceSha256: sha256, clinicalScriptSha256: sha256, audioSha256: sha256,
  technicalEvidenceSha256: sha256, documentaryEvidenceSha256: sha256,
  asrTranscriptSha256: sha256,
  method: z.literal('local_asr_decode_documentary_comparison'), humanListening: z.literal(false),
  criticalContentChecked: z.literal(true), notes: z.string().trim().min(1),
  comparison: z.object({ expectedText: z.string().trim().min(1), recognizedText: z.string().trim().min(1),
    reconciliation: z.string().trim().min(1), unresolvedCriticalDiscrepancy: z.literal(false),
  }).strict(),
  criticalChecks: z.object({
    negation: z.enum(['preserved', 'not_applicable']), numbersUnits: z.enum(['preserved', 'not_applicable']),
    urgency: z.enum(['preserved', 'not_applicable']), medicationAuthority: z.enum(['preserved', 'not_applicable']),
    deliveryClaims: z.enum(['preserved', 'not_applicable']), syntheticBoundary: z.enum(['preserved', 'not_applicable']),
  }).strict(),
}).strict();
export const delegatedVerificationEvidenceSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('synthetic_audio_verification'), verification: delegatedVerification,
}).strict();

export const audioReleaseSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  scope,
  delegatedRelease: delegatedAuthority.extend(reference).optional(),
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
    clinicalScriptSha256: sha256.optional(),
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
    delegatedVerification: delegatedVerification.extend(reference).optional(),
  }).strict()),
}).strict().superRefine((release, ctx) => {
  if (release.schemaVersion === 1 && (release.delegatedRelease || release.clips.some(c => c.delegatedVerification))) {
    ctx.addIssue({ code: 'custom', message: 'Delegated evidence requires explicit schema version 2' });
  }
});

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
  // Revocation is a veto across authorization routes; a second route cannot
  // silently restore the same recording without an explicit new release.
  if (release.delegatedRelease?.state === 'revoked' || clip.delegatedVerification?.state === 'revoked' ||
    Object.values(clip.decisions).some(decision => decision?.state === 'revoked')) return { canPlay: false, reason: 'revoked' };
  if (clip.technical.asrFinding === 'source_mismatch') return { canPlay: false, reason: 'source_mismatch' };
  // Existing human decisions cannot be bypassed with the delegated path.
  const hasHumanDecision = Object.values(clip.decisions).some(decision => decision !== null);
  if (!hasHumanDecision && release.schemaVersion === 2 && release.delegatedRelease) {
    const authority = release.delegatedRelease;
    const verified = clip.delegatedVerification;
    if (authority.state === 'revoked' || verified?.state === 'revoked') return { canPlay: false, reason: 'revoked' };
    if (!verified || verified.state !== 'passed' || clip.technical.asrFinding !== 'reconciled') {
      return { canPlay: false, reason: 'review_pending' };
    }
    if (verified.scope !== release.scope || authority.scope !== release.scope || verified.locale !== clip.locale ||
      verified.sourceSha256 !== clip.sourceSha256 || verified.clinicalScriptSha256 !== clip.clinicalScriptSha256 ||
      verified.audioSha256 !== clip.audioSha256 || verified.technicalEvidenceSha256 !== release.evidence.sha256 ||
      verified.documentaryEvidenceSha256 !== authority.documentaryEvidenceSha256) {
      return { canPlay: false, reason: 'stale_decision' };
    }
    return { canPlay: true, reason: 'approved', url: `/outreach-audio/releases/${clip.audioSha256}.mp3` };
  }
  for (const [kind, decision] of Object.entries(clip.decisions)) {
    if (!decision || decision.state !== 'approved') return { canPlay: false, reason: decision?.state === 'revoked' ? 'revoked' : 'review_pending' };
    if (decision.dimension !== kind || decision.role !== REVIEW_ROLES[kind as keyof typeof REVIEW_ROLES] ||
      decision.sourceSha256 !== clip.sourceSha256 || decision.audioSha256 !== clip.audioSha256 ||
      decision.scope !== release.scope || decision.locale !== clip.locale) return { canPlay: false, reason: 'stale_decision' };
  }
  if (clip.technical.asrFinding !== 'reconciled') return { canPlay: false, reason: 'review_pending' };
  return { canPlay: true, reason: 'approved', url: `/outreach-audio/releases/${clip.audioSha256}.mp3` };
}
