/** Offline, read-only build gate. Does not synthesize, approve or load credentials. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { audioCatalog } from './generate-outreach-audio.mts';
import { audioReleaseSchema, audioReleaseDecision, audioDecisionEvidenceSchema,
  delegatedAuthorityEvidenceSchema, documentaryAudioEvidenceSchema, delegatedVerificationEvidenceSchema,
  type AudioRelease } from '../lib/sandbox-ai/static-audio-release-schema';

const root = path.resolve(import.meta.dirname, '..');
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
type Identity = { relativePath: string; locale: 'en' | 'es'; sourceSha256: string; clinicalScriptSha256?: string; body?: string };
type GenerationReceipt = { sourceSha256: string; audioSha256: string; generatedAt: string; modelId: string };
const evidenceDirectory = path.join(root, 'reference/audio-releases');
const asrObservationSchema = z.object({
  path: z.string().min(1), locale: z.enum(['en', 'es']),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/), audioSha256: z.string().regex(/^[a-f0-9]{64}$/),
  observedAt: z.string().datetime({ offset: true }), duration: z.number().positive(),
  model: z.string().startsWith('Systran/faster-whisper-'), engineVersion: z.string().min(1),
  decoder: z.literal('ffmpeg pcm f32le mono 16000 Hz'), decoded: z.literal(true),
  transcript: z.string().trim().min(1), sourceTexts: z.array(z.string().trim().min(1)).min(1),
  segments: z.array(z.object({ start: z.number().nonnegative(), end: z.number().positive(),
    text: z.string().trim().min(1), avgLogprob: z.number(), noSpeechProb: z.number().min(0).max(1),
  }).refine(segment => segment.end > segment.start)).min(1),
  humanListening: z.literal(false), approval: z.null(),
});

export function audioSourceCatalogSha256(catalog: Identity[]) {
  return sha(Buffer.from(JSON.stringify(catalog.map(job => ({ path: job.relativePath, locale: job.locale,
    sourceSha256: job.sourceSha256, clinicalScriptSha256: job.clinicalScriptSha256 })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0))));
}

export function publicPlaybackProjection(release: AudioRelease) {
  return { schemaVersion: 1, clips: release.clips.map(clip => ({
    path: clip.path, locale: clip.locale,
    ...audioReleaseDecision(release, `/outreach-audio/${clip.path}`, clip.locale),
  })) };
}

export function verifyAudioRelease(input: unknown, catalog: Identity[], readAudio: (relative: string) => Buffer,
  readEvidence: (relative: string) => Buffer = relative => readFileSync(path.join(evidenceDirectory, relative)),
  receipts: Record<string, GenerationReceipt> = {}, now = Date.now()) {
  const release = audioReleaseSchema.parse(input);
  const technicalBytes = readEvidence(release.evidence.file);
  if (sha(technicalBytes) !== release.evidence.sha256) throw new Error('Technical evidence file digest mismatch');
  const observations = technicalBytes.toString('utf8').trim().split('\n').map(line => JSON.parse(line) as {
    path: string; locale: string; sourceSha256: string; audioSha256: string; observedAt: string; duration: number;
  });
  const notFuture = (value: string) => Number.isFinite(Date.parse(value)) && Date.parse(value) <= now;
  const referenced = (ref: string, digest: string) => {
    if (ref !== `${digest}.json`) throw new Error('Delegated evidence reference invalid');
    const bytes = readEvidence(ref);
    if (sha(bytes) !== digest) throw new Error('Delegated evidence digest mismatch');
    return JSON.parse(bytes.toString('utf8'));
  };
  if (release.delegatedRelease) {
    const authority = release.delegatedRelease;
    if (release.schemaVersion !== 2 || !notFuture(authority.recordedAt) ||
      catalog.some(job => !job.clinicalScriptSha256) || authority.catalogSha256 !== audioSourceCatalogSha256(catalog)) {
      throw new Error('Delegated authority catalog or date invalid');
    }
    const artifact = delegatedAuthorityEvidenceSchema.parse(referenced(authority.evidenceRef, authority.evidenceSha256));
    const { evidenceRef: _ref, evidenceSha256: _digest, ...expected } = authority;
    if (JSON.stringify(artifact.authority) !== JSON.stringify(expected)) throw new Error('Delegated authority fields differ');
    const documentary = documentaryAudioEvidenceSchema.parse(referenced(authority.documentaryEvidenceRef, authority.documentaryEvidenceSha256));
    if (!notFuture(documentary.recordedAt) || documentary.catalogSha256 !== authority.catalogSha256 || documentary.scope !== release.scope) {
      throw new Error('Documentary evidence catalog or date invalid');
    }
  }
  if (release.clips.length !== catalog.length || new Set(release.clips.map(c => c.path)).size !== catalog.length) {
    throw new Error('Audio release catalog must match every source exactly once');
  }
  let approved = 0;
  for (const clip of release.clips) {
    const source = catalog.find(job => job.relativePath === clip.path);
    if (!source || source.locale !== clip.locale || source.sourceSha256 !== clip.sourceSha256) throw new Error(`Source identity changed: ${clip.path}`);
    if (clip.clinicalScriptSha256 && clip.clinicalScriptSha256 !== source.clinicalScriptSha256) throw new Error(`Clinical script identity changed: ${clip.path}`);
    if (sha(readAudio(clip.path)) !== clip.audioSha256) throw new Error(`Recording identity changed: ${clip.path}`);
    if (clip.technical.evidenceSha256 !== release.evidence.sha256) throw new Error(`Technical evidence identity changed: ${clip.path}`);
    const observed = observations.filter(entry => entry.path === clip.path);
    if (observed.length !== 1 || observed[0].audioSha256 !== clip.audioSha256 || observed[0].sourceSha256 !== clip.sourceSha256 ||
      observed[0].locale !== clip.locale || observed[0].observedAt !== clip.observedAt || observed[0].duration !== clip.duration ||
      !notFuture(clip.observedAt)) throw new Error(`Technical evidence does not bind this recording: ${clip.path}`);
    if (clip.delegatedVerification) {
      const verified = clip.delegatedVerification;
      if (!release.delegatedRelease || !notFuture(verified.recordedAt) || Date.parse(verified.recordedAt) < Date.parse(clip.observedAt) ||
        Date.parse(verified.recordedAt) < Date.parse(release.delegatedRelease.recordedAt)) {
        throw new Error(`Delegated verification authority or date invalid: ${clip.path}`);
      }
      const asr = asrObservationSchema.parse(observed[0]);
      if (asr.segments.some((segment, index) => segment.start > asr.duration || segment.end > asr.duration + 2 ||
        (index > 0 && segment.start < asr.segments[index - 1].start))) throw new Error(`ASR segment timing invalid: ${clip.path}`);
      const payload = source.body ? JSON.parse(source.body) : undefined;
      const texts: string[] = payload?.inputs ? payload.inputs.map((turn: { text: string }) => turn.text) : payload?.text ? [payload.text] : [];
      const expectedTexts = texts.map(text => text.replace(/\[[^\]]*\]\s*/g, ''));
      if (asr.segments.map(segment => segment.text.trim()).join(' ') !== asr.transcript ||
        JSON.stringify(asr.sourceTexts) !== JSON.stringify(expectedTexts) ||
        sha(Buffer.from(asr.transcript)) !== verified.asrTranscriptSha256 ||
        verified.comparison.expectedText !== expectedTexts.join(' ') || verified.comparison.recognizedText !== asr.transcript) {
        throw new Error(`ASR content does not bind this verification: ${clip.path}`);
      }
      const artifact = delegatedVerificationEvidenceSchema.parse(referenced(verified.evidenceRef, verified.evidenceSha256));
      const { evidenceRef: _ref, evidenceSha256: _digest, ...expected } = verified;
      if (JSON.stringify(artifact.verification) !== JSON.stringify(expected)) throw new Error(`Delegated verification fields differ: ${clip.path}`);
      if (verified.state === 'passed' && !audioReleaseDecision(release, `/outreach-audio/${clip.path}`, clip.locale).canPlay) {
        throw new Error(`Invalid delegated activation: ${clip.path}`);
      }
    }
    if (clip.provenance === 'generation_receipt') {
      const receipt = receipts[clip.path];
      const model = source.body ? JSON.parse(source.body).model_id : undefined;
      if (!receipt || receipt.sourceSha256 !== clip.sourceSha256 || receipt.audioSha256 !== clip.audioSha256 ||
        !model || receipt.modelId !== model || !notFuture(receipt.generatedAt) ||
        Date.parse(receipt.generatedAt) > Date.parse(clip.observedAt)) throw new Error(`Generation receipt missing or stale: ${clip.path}`);
    }
    for (const [kind, decision] of Object.entries(clip.decisions)) {
      if (!decision) continue;
      if (!notFuture(decision.reviewedAt) || decision.dimension !== kind) throw new Error(`Decision date or dimension invalid: ${clip.path}`);
      if (decision.evidenceRef !== `${decision.evidenceSha256}.json`) throw new Error(`Decision reference invalid: ${clip.path}`);
      const bytes = readEvidence(decision.evidenceRef);
      if (sha(bytes) !== decision.evidenceSha256) throw new Error(`Decision evidence digest mismatch: ${clip.path}`);
      const artifact = audioDecisionEvidenceSchema.parse(JSON.parse(bytes.toString('utf8')));
      const { evidenceRef: _ref, evidenceSha256: _digest, ...expected } = decision;
      if (JSON.stringify(artifact.decision) !== JSON.stringify(expected)) throw new Error(`Decision evidence fields differ: ${clip.path}`);
    }
    const decision = audioReleaseDecision(release, `/outreach-audio/${clip.path}`, clip.locale);
    // An activation approval cannot silently survive an invalid/revoked decision.
    if (clip.decisions.activation?.state === 'approved' && !decision.canPlay) throw new Error(`Invalid activation: ${clip.path} (${decision.reason})`);
    if (decision.canPlay) {
      if (sha(readAudio(`releases/${clip.audioSha256}.mp3`)) !== clip.audioSha256) throw new Error(`Immutable release bytes changed: ${clip.path}`);
      approved++;
    }
  }
  return { catalog: catalog.length, approved, paused: catalog.length - approved };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const manifest = JSON.parse(readFileSync(path.join(root, 'lib/sandbox-ai/static-audio-release.json'), 'utf8'));
  const receiptPath = path.join(root, 'public/outreach-audio/generation-manifest.json');
  const receipts = existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, 'utf8')).clips : {};
  const result = verifyAudioRelease(manifest, audioCatalog(), relative => readFileSync(path.join(root, 'public/outreach-audio', relative)), undefined, receipts);
  const expected = `${JSON.stringify(publicPlaybackProjection(audioReleaseSchema.parse(manifest)), null, 2)}\n`;
  const output = path.join(root, 'lib/sandbox-ai/static-audio-playback.generated.json');
  if (process.argv.includes('--sync')) writeFileSync(output, expected);
  else if (readFileSync(output, 'utf8') !== expected) throw new Error('Public playback projection is stale; review the release and run audio:sync');
  console.log(JSON.stringify(result));
}
