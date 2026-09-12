/**
 * One-shot generator for the Automated Outreach demo audio (S5).
 *
 * Renders each scripted transcript in lib/sandbox-ai/fixtures.ts to a single
 * MP3 under public/outreach-audio/ using the ElevenLabs Text to Dialogue API
 * (eleven_v3): the whole conversation is synthesized in one request, so
 * turn-taking, pacing, and prosody stay natural across speakers.
 *
 * Expressive audio tags are injected here per (call, turn) — they shape the
 * audio only and never appear in the on-screen transcript.
 *
 * Run locally only (the key never reaches CI or the client; since S7 the
 * same key also lives in Vercel server env for runtime TTS -- see
 * lib/sandbox-ai/tts.ts):
 *   npm run audio:outreach -- --dry-run
 *   npm run audio:outreach -- --only prompts/daily_checkin/en/escalated.mp3 --force --dry-run
 *   npm run audio:outreach -- --only prompts/daily_checkin/en/escalated.mp3 --force --max-chars 1000
 *
 * Actual synthesis requires an explicit character budget and an environment
 * key (or .env.local). Character counts include audio tags; they are input
 * estimates, not billing guarantees. Existing audio is never overwritten
 * without --force. A receipt verifies source/audio identity, not clinical or
 * linguistic approval. Historical clips without receipts remain unverified.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { callPromptsFor, fillerPromptsFor, type CallPrompt } from '../lib/sandbox-ai/call-prompts';
import { OUTREACH_TRANSCRIPTS } from '../lib/sandbox-ai/fixtures';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'outreach-audio');
const MODEL_ID = 'eleven_v3';
const MANIFEST_PATH = path.join(OUT_DIR, 'generation-manifest.json');

// Assistant: premade conversational voice. Patients: elderly voices designed
// with the ElevenLabs Voice Design API (saved in the account's My Voices as
// heartland-demo-elderly-f / heartland-demo-elderly-m).
const ASSISTANT_VOICE = 'cgSgspJ2msm6clMCkdW9'; // Jessica — warm, conversational
const PATIENT_VOICES: Record<string, string> = {
  'call-maria-redflag': 'AlYtu5D8hiZPla1NvjUc', // elderly woman, rural NM
  'call-james-stable': '4CbDIzwvbRuUDQCM6uCh', // elderly man, rural KS
  'call-james-adherence': '4CbDIzwvbRuUDQCM6uCh',
};

// Eleven v3 audio tags per (call id, turn index) — audio-only expressiveness.
const AUDIO_TAGS: Record<string, Record<number, string>> = {
  'call-maria-redflag': { 1: '[tired]', 3: '[distracted, searching]', 7: '[sighs]', 9: '[tired]', 12: '[calm, reassuring]', 13: '[tired, grateful]' },
  'call-james-stable': { 1: '[cheerfully]', 5: '[proudly]', 7: '[chuckles]', 9: '[warmly]' },
  'call-james-adherence': { 7: '[hesitant, a little embarrassed]', 8: '[warmly]', 9: '[relieved]' },
  'call-robert-noanswer': { 0: '[calm, professional]', 1: '[calm, professional]' },
};

function apiKey(): string {
  const environmentKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (environmentKey) return environmentKey;
  const envPath = path.join(ROOT, '.env.local');
  const envLocal = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const match = /^ELEVENLABS_API_KEY=(.+)$/m.exec(envLocal);
  const key = match?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2');
  if (!key) throw new Error('ELEVENLABS_API_KEY not found in environment or .env.local');
  return key;
}

type Locale = 'en' | 'es';
interface AudioOptions {
  dryRun: boolean;
  force: boolean;
  locales: Locale[];
  only?: string[];
  maxChars?: number;
}
interface AudioJob {
  relativePath: string;
  locale: Locale;
  endpoint: string;
  body: string;
  characters: number;
  sourceSha256: string;
}
interface AudioReceipt {
  sourceSha256: string;
  audioSha256: string;
  generatedAt: string;
  modelId: string;
}
interface AudioManifest { schemaVersion: 1; clips: Record<string, AudioReceipt> }

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

export function parseAudioArgs(args: string[]): AudioOptions {
  const options: AudioOptions = { dryRun: false, force: false, locales: ['en', 'es'] };
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (seen.has(flag)) throw new Error(`Duplicate option: ${flag}`);
    seen.add(flag);
    if (flag === '--dry-run') options.dryRun = true;
    else if (flag === '--force') options.force = true;
    else if (['--only', '--locales', '--max-chars'].includes(flag)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
      if (flag === '--max-chars') {
        if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Invalid --max-chars budget');
        options.maxChars = Number(value);
      } else {
        const values = value.split(',').map((entry) => entry.trim());
        if (values.some((entry) => !entry) || new Set(values).size !== values.length) throw new Error(`Invalid ${flag} list`);
        if (flag === '--only') options.only = values;
        else {
          if (values.some((entry) => entry !== 'en' && entry !== 'es')) throw new Error('Invalid --locales; use en, es, or en,es');
          options.locales = values as Locale[];
        }
      }
    } else throw new Error(`Unknown option: ${flag}`);
  }
  return options;
}

export function audioCatalog(): AudioJob[] {
  const jobs: AudioJob[] = [];
  const add = (relativePath: string, locale: Locale, endpoint: string, payload: object, characters: number) => {
    const body = JSON.stringify(payload);
    jobs.push({ relativePath, locale, endpoint, body, characters, sourceSha256: sha256(`${endpoint}\n${body}`) });
  };
  for (const transcript of OUTREACH_TRANSCRIPTS) {
    const inputs = transcript.turns.map((turn, index) => {
      const tag = AUDIO_TAGS[transcript.id]?.[index];
      const text = tag ? `${tag} ${turn.text}` : turn.text;
      return {
        text,
        voice_id: turn.speaker === 'assistant'
          ? ASSISTANT_VOICE
          : PATIENT_VOICES[transcript.id] ?? ASSISTANT_VOICE,
      };
    });
    add(`${transcript.id}.mp3`, 'en', 'https://api.elevenlabs.io/v1/text-to-dialogue',
      { inputs, model_id: MODEL_ID }, inputs.reduce((sum, input) => sum + input.text.length, 0));
  }
  for (const locale of ['en', 'es'] as const) {
    const clips: CallPrompt[] = [
      ...(['daily_checkin', 'titration_followup'] as const).flatMap((script) => Object.values(callPromptsFor(script, locale))),
      ...fillerPromptsFor(locale),
    ];
    for (const clip of clips) {
      add(clip.audioSrc.replace('/outreach-audio/', ''), locale,
        `https://api.elevenlabs.io/v1/text-to-speech/${ASSISTANT_VOICE}`,
        { text: clip.text, model_id: MODEL_ID }, clip.text.length);
    }
  }
  return jobs;
}

function readManifest(): AudioManifest {
  if (!existsSync(MANIFEST_PATH)) return { schemaVersion: 1, clips: {} };
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as AudioManifest;
  if (manifest.schemaVersion !== 1 || !manifest.clips || typeof manifest.clips !== 'object' || Array.isArray(manifest.clips)) {
    throw new Error('Invalid audio manifest; reconcile it before synthesis');
  }
  for (const receipt of Object.values(manifest.clips)) {
    if (!receipt || !/^[a-f0-9]{64}$/.test(receipt.sourceSha256) || !/^[a-f0-9]{64}$/.test(receipt.audioSha256)) {
      throw new Error('Invalid audio receipt; reconcile it before synthesis');
    }
  }
  return manifest;
}

export function planAudioGeneration(options: AudioOptions) {
  const catalog = audioCatalog().filter((job) => options.locales.includes(job.locale));
  for (const selected of options.only ?? []) {
    if (!catalog.some((job) => job.relativePath === selected)) throw new Error(`Unknown or locale-excluded clip: ${selected}`);
  }
  const manifest = readManifest();
  const jobs = catalog.filter((job) => !options.only || options.only.includes(job.relativePath)).map((job) => {
    const outFile = path.join(OUT_DIR, job.relativePath);
    const receipt = manifest.clips[job.relativePath];
    const exists = existsSync(outFile);
    const state = !exists ? 'missing' : !receipt ? 'unverified'
      : receipt.sourceSha256 === job.sourceSha256 && receipt.audioSha256 === sha256(readFileSync(outFile)) ? 'current' : 'stale';
    return { ...job, state, generate: !exists || options.force };
  });
  const characters = jobs.filter((job) => job.generate).reduce((sum, job) => sum + job.characters, 0);
  if (options.maxChars !== undefined && characters > options.maxChars) throw new Error(`Audio plan exceeds budget: ${characters} > ${options.maxChars} input characters`);
  return { jobs, characters, manifest };
}

export async function runAudioGeneration(args: string[] = process.argv.slice(2)) {
  const options = parseAudioArgs(args);
  const plan = planAudioGeneration(options);
  for (const job of plan.jobs) {
    console.log(`${job.generate ? 'generate' : 'skip'} ${job.relativePath} (${job.state}; ${job.characters} input characters; source ${job.sourceSha256})`);
  }
  const pending = plan.jobs.filter((job) => job.generate);
  console.log(`plan: ${pending.length} requests, ${plan.characters} estimated input characters; ${options.dryRun ? 'dry run, no synthesis' : 'explicit budget required for synthesis'}`);
  if (options.dryRun || pending.length === 0) return plan;
  if (options.maxChars === undefined) throw new Error('Synthesis requires --max-chars after reviewing --dry-run output');
  const key = apiKey();
  for (const job of pending) {
    const response = await fetch(job.endpoint, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json' },
      body: job.body,
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) throw new Error(`Audio synthesis failed (${response.status}) for ${job.relativePath}`);
    if (!response.headers.get('content-type')?.startsWith('audio/')) throw new Error(`Unexpected audio content type for ${job.relativePath}`);
    const audio = Buffer.from(await response.arrayBuffer());
    if (!audio.length) throw new Error(`Empty audio for ${job.relativePath}`);
    const outFile = path.join(OUT_DIR, job.relativePath);
    mkdirSync(path.dirname(outFile), { recursive: true });
    writeFileSync(outFile, audio);
    plan.manifest.clips[job.relativePath] = {
      sourceSha256: job.sourceSha256, audioSha256: sha256(audio), generatedAt: new Date().toISOString(), modelId: MODEL_ID,
    };
    writeFileSync(MANIFEST_PATH, `${JSON.stringify(plan.manifest, null, 2)}\n`);
    console.log(`wrote ${path.relative(ROOT, outFile)} and provenance receipt`);
  }
  console.log(`done: ${pending.length} audio files; inspect wording, sound, and receipts before publication`);
  return plan;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runAudioGeneration().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Audio generation failed');
    process.exitCode = 1;
  });
}
