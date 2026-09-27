/** Offline review packet only. Never synthesizes, transcribes, approves or enables audio.
 * npx tsx scripts/prepare-audio-review.mts --output /absolute/new/review-directory
 * Reuses the actual generation catalog without calling its execution entrypoint.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { audioCatalog, parseAudioArgs, planAudioGeneration } from './generate-outreach-audio.mts';

type Job = ReturnType<typeof audioCatalog>[number] & { state: string };
type Receipts = Record<string, { sourceSha256: string; audioSha256: string }>;
const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const root = path.resolve(import.meta.dirname, '..');

export function buildAudioReviewPacket(jobs: Job[], audio: ReadonlyMap<string, Buffer>, preparedAt: string, receipts: Receipts = {}) {
  if (!Number.isFinite(Date.parse(preparedAt))) throw new Error('Invalid preparation time');
  const seen = new Set<string>();
  const clips = jobs.map((job) => {
    if (!/^(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.mp3$/.test(job.relativePath) || seen.has(job.relativePath)) {
      throw new Error('Invalid or duplicate audio path');
    }
    seen.add(job.relativePath);
    if (!['missing', 'unverified', 'current', 'stale'].includes(job.state)
      || job.sourceSha256 !== sha(`${job.endpoint}\n${job.body}`)) throw new Error('Invalid source identity');
    const payload: unknown = JSON.parse(job.body);
    if (!payload || typeof payload !== 'object') throw new Error('Invalid source payload');
    const body = payload as { text?: unknown; inputs?: unknown; model_id?: unknown };
    const sourceTexts = typeof body.text === 'string' ? [body.text]
      : Array.isArray(body.inputs) ? body.inputs.map((input: unknown) => {
        if (!input || typeof input !== 'object' || !('text' in input) || typeof input.text !== 'string') throw new Error('Invalid dialogue turn');
        return input.text;
      }) : [];
    if (!sourceTexts.length || sourceTexts.some((text) => !text.trim()) || typeof body.model_id !== 'string') throw new Error('Missing source text/model');
    const bytes = audio.get(job.relativePath);
    if ((job.state === 'missing') !== (bytes === undefined) || (bytes !== undefined && bytes.length === 0)) throw new Error('Inconsistent audio inventory');
    const audioSha256 = bytes === undefined ? null : sha(bytes);
    const receipt = receipts[job.relativePath];
    if (receipt && (!/^[a-f0-9]{64}$/.test(receipt.sourceSha256) || !/^[a-f0-9]{64}$/.test(receipt.audioSha256))) throw new Error('Invalid audio receipt');
    // Never reuse the plan's earlier current/stale decision: bind the receipt to
    // exactly the same bytes whose digest is serialized below.
    const generationIdentity = bytes === undefined ? 'missing' : !receipt ? 'unverified'
      : receipt.sourceSha256 === job.sourceSha256 && receipt.audioSha256 === audioSha256
        ? 'source_and_audio_match_receipt' : 'stale';
    return {
      path: job.relativePath, locale: job.locale, sourceSha256: job.sourceSha256,
      sourceTexts, sourceModel: body.model_id,
      // The digest describes file identity, NOT its spoken words or historical model.
      audioSha256, audioBytes: bytes?.length ?? null,
      generationIdentity,
      sourceTextIsAudioTranscript: false as const, playbackApproved: false as const,
      review: { clinical: null, linguistic: null, listening: null, activation: null },
    };
  });
  return { schemaVersion: 1, preparedAt, purpose: 'offline_review_only', synthesisRequests: 0,
    playbackEnabled: false, clips };
}

export function renderAudioReviewPacket(packet: ReturnType<typeof buildAudioReviewPacket>) {
  const lines = ['# HEARTLAND EN/ES audio review packet', '',
    `Prepared: ${packet.preparedAt}. Offline identity and source-text review only.`, '',
    '**HOLD: no playback approval, synthesis, transcription or listening review is implied.**', '',
    'The text below is the current generation input, including expressive tags where present. It is NOT a transcription of the historical MP3.',
    'A matching generation receipt proves identity only; clinical, linguistic, listening and activation decisions remain separate.',
    'The source model is a proposed/current input, not verified provenance of an unreceipted recording.', '',
    '## Review procedure', '',
    '1. Identify the exact source/audio hashes and proposed audience/context. Review EN and ES together where a counterpart exists.',
    '2. A qualified reviewer records clinical wording and language decisions separately, including limitations and policy references.',
    '3. Where approved, compare the actual recording with the approved script: numbers, units, negations, pronunciation, role boundaries and emergency wording. Record observed deviations, not assumed equivalence.',
    '4. If regeneration is required, obtain separate voice/budget authorization. Regeneration changes identity and requires a new packet and listening review.',
    '5. Activation requires a separate exact-asset decision and technical release. This packet is never consumed as a runtime approval switch.', '',
    'Do not fill missing approvals by inference. P3 and unresolved clinical policies remain gates. Patient education’s eight domains are a different content set, not covered by these outreach clips.', '',
    `Catalog: ${packet.clips.length} clips; EN ${packet.clips.filter((clip) => clip.locale === 'en').length}; ES ${packet.clips.filter((clip) => clip.locale === 'es').length}.`, '',
    '## Inventory', '', '|Clip|Locale|Generation identity|Playback|', '|-|-|-|-|',
    ...packet.clips.map((clip) => `|${clip.path}|${clip.locale}|${clip.generationIdentity}|HOLD|`), '',
    '## Exact per-clip reading set and blank decisions', ''];
  for (const clip of packet.clips) {
    lines.push(`### ${clip.path}`, '', `Locale: ${clip.locale}. Source model input: ${clip.sourceModel}.`, '',
      `Source SHA-256: ${clip.sourceSha256}`, '', `Audio SHA-256: ${clip.audioSha256 ?? 'MISSING'}`, '',
      `Audio bytes: ${clip.audioBytes ?? 'MISSING'}. Generation identity: ${clip.generationIdentity}. Playback: HOLD.`, '',
      'Current source input, JSON-quoted to preserve punctuation and turn boundaries (not an audio transcript):', '',
      ...clip.sourceTexts.map((text, index) => `    ${index + 1}. ${JSON.stringify(text)}`), '',
      '|Review dimension|Named qualified reviewer; date; exact hashes|Decision, observations and unresolved policy|', '|-|-|-|',
      '|Clinical source text|Unassigned|Not reviewed|', '|Language/source EN–ES relationship|Unassigned|Not reviewed|',
      '|Actual recording/listening comparison|Unassigned|Not reviewed|', '|Separate playback/release decision|Unassigned|Not authorized|', '');
  }
  return `${lines.join('\n')}\n`;
}

export function prepareAudioReview(output: string) {
  if (!path.isAbsolute(output)) throw new Error('An absolute new output directory is required');
  const requested = path.resolve(output);
  const canonicalRoot = realpathSync(root);
  // Resolve the existing parent before creating anything, including external
  // symlink aliases into public/. Write through the canonical path, not the alias.
  const out = path.join(realpathSync(path.dirname(requested)), path.basename(requested));
  if (out === canonicalRoot || out.startsWith(`${canonicalRoot}${path.sep}`)) throw new Error('Keep review packets outside the application/deploy tree');
  // Planning reads only source/receipts/audio. It never loads credentials or invokes synthesis.
  const plan = planAudioGeneration(parseAudioArgs(['--dry-run']));
  const audio = new Map(plan.jobs.filter((job) => job.state !== 'missing')
    .map((job) => [job.relativePath, readFileSync(path.join(root, 'public/outreach-audio', job.relativePath))]));
  const packet = buildAudioReviewPacket(plan.jobs, audio, new Date().toISOString(), plan.manifest.clips);
  mkdirSync(out); // Refuse an existing packet: never overwrite recorded human reviews.
  writeFileSync(path.join(out, 'audio-review.json'), `${JSON.stringify(packet, null, 2)}\n`, { flag: 'wx' });
  writeFileSync(path.join(out, 'AUDIO_REVIEW.md'), renderAudioReviewPacket(packet), { flag: 'wx' });
  return { directory: out, clips: packet.clips.length, playbackEnabled: false, synthesisRequests: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== '--output') throw new Error('Use --output /absolute/new/review-directory');
    console.log(JSON.stringify(prepareAudioReview(args[1])));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Audio review preparation failed');
    process.exitCode = 1;
  }
}
