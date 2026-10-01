/** Offline, read-only build gate. Does not synthesize, approve or load credentials. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { audioCatalog } from './generate-outreach-audio.mts';
import { audioReleaseSchema, audioReleaseDecision, audioDecisionEvidenceSchema, type AudioRelease } from '../lib/sandbox-ai/static-audio-release-schema';

const root = path.resolve(import.meta.dirname, '..');
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
type Identity = { relativePath: string; locale: 'en' | 'es'; sourceSha256: string; body?: string };
type GenerationReceipt = { sourceSha256: string; audioSha256: string; generatedAt: string; modelId: string };
const evidenceDirectory = path.join(root, 'reference/audio-releases');

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
  if (release.clips.length !== catalog.length || new Set(release.clips.map(c => c.path)).size !== catalog.length) {
    throw new Error('Audio release catalog must match every source exactly once');
  }
  let approved = 0;
  for (const clip of release.clips) {
    const source = catalog.find(job => job.relativePath === clip.path);
    if (!source || source.locale !== clip.locale || source.sourceSha256 !== clip.sourceSha256) throw new Error(`Source identity changed: ${clip.path}`);
    if (sha(readAudio(clip.path)) !== clip.audioSha256) throw new Error(`Recording identity changed: ${clip.path}`);
    if (clip.technical.evidenceSha256 !== release.evidence.sha256) throw new Error(`Technical evidence identity changed: ${clip.path}`);
    const observed = observations.filter(entry => entry.path === clip.path);
    if (observed.length !== 1 || observed[0].audioSha256 !== clip.audioSha256 || observed[0].sourceSha256 !== clip.sourceSha256 ||
      observed[0].locale !== clip.locale || observed[0].observedAt !== clip.observedAt || observed[0].duration !== clip.duration ||
      !notFuture(clip.observedAt)) throw new Error(`Technical evidence does not bind this recording: ${clip.path}`);
    if (clip.provenance === 'generation_receipt') {
      const receipt = receipts[clip.path];
      const model = source.body ? JSON.parse(source.body).model_id : undefined;
      if (!receipt || receipt.sourceSha256 !== clip.sourceSha256 || receipt.audioSha256 !== clip.audioSha256 ||
        !model || receipt.modelId !== model || !notFuture(receipt.generatedAt)) throw new Error(`Generation receipt missing or stale: ${clip.path}`);
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
