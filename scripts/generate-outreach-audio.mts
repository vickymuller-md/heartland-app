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
 *   npm run audio:outreach            # skips files that already exist
 *   npm run audio:outreach -- --force # regenerate everything
 *
 * Requires ELEVENLABS_API_KEY in .env.local.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { callPromptsFor, fillerPromptsFor, type CallPrompt } from '../lib/sandbox-ai/call-prompts';
import { OUTREACH_TRANSCRIPTS } from '../lib/sandbox-ai/fixtures';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'outreach-audio');
const MODEL_ID = 'eleven_v3';
const FORCE = process.argv.includes('--force');
// --locales en (or en,es) limits prompt generation, e.g. while the Spanish
// wording is still in clinical review. Default: both.
const localesArg = process.argv.indexOf('--locales');
const LOCALES = new Set(
  (localesArg >= 0 ? process.argv[localesArg + 1] : 'en,es').split(',').map((entry) => entry.trim()),
);

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
  const envLocal = readFileSync(path.join(ROOT, '.env.local'), 'utf8');
  const match = /^ELEVENLABS_API_KEY=(.+)$/m.exec(envLocal);
  const key = process.env.ELEVENLABS_API_KEY ?? match?.[1]?.trim();
  if (!key) throw new Error('ELEVENLABS_API_KEY not found in environment or .env.local');
  return key;
}

async function main() {
  const key = apiKey();
  mkdirSync(OUT_DIR, { recursive: true });

  let totalChars = 0;
  for (const transcript of OUTREACH_TRANSCRIPTS) {
    const outFile = path.join(OUT_DIR, `${transcript.id}.mp3`);
    if (existsSync(outFile) && !FORCE) {
      console.log(`skip ${transcript.id} (exists; use --force to regenerate)`);
      continue;
    }

    const inputs = transcript.turns.map((turn, index) => {
      const tag = AUDIO_TAGS[transcript.id]?.[index];
      const text = tag ? `${tag} ${turn.text}` : turn.text;
      totalChars += text.length;
      return {
        text,
        voice_id: turn.speaker === 'assistant'
          ? ASSISTANT_VOICE
          : PATIENT_VOICES[transcript.id] ?? ASSISTANT_VOICE,
      };
    });

    const response = await fetch('https://api.elevenlabs.io/v1/text-to-dialogue', {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ inputs, model_id: MODEL_ID }),
    });
    if (!response.ok) {
      throw new Error(`Dialogue synthesis failed (${response.status}) for ${transcript.id}: ${(await response.text()).slice(0, 200)}`);
    }
    writeFileSync(outFile, Buffer.from(await response.arrayBuffer()));
    console.log(`wrote ${path.relative(ROOT, outFile)} (${transcript.turns.length} turns, one dialogue request)`);
  }

  // Fixed spoken prompts for the simulated live calls (assistant voice,
  // single TTS each), one set per script and locale, plus the fillers. The
  // same premade voice speaks both languages (eleven_v3 is multilingual).
  const locales = (['en', 'es'] as const).filter((locale) => LOCALES.has(locale));
  const promptSets: CallPrompt[][] = [
    ...(['daily_checkin', 'titration_followup'] as const).flatMap((script) =>
      locales.map((locale) => Object.values(callPromptsFor(script, locale)))),
    ...locales.map((locale) => fillerPromptsFor(locale)),
  ];
  for (const clips of promptSets) {
    for (const clip of clips) {
      // audioSrc is the public URL; mirror it under public/outreach-audio/.
      const outFile = path.join(OUT_DIR, clip.audioSrc.replace('/outreach-audio/', ''));
      if (existsSync(outFile) && !FORCE) {
        console.log(`skip ${path.relative(OUT_DIR, outFile)} (exists)`);
        continue;
      }
      mkdirSync(path.dirname(outFile), { recursive: true });
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ASSISTANT_VOICE}`, {
        method: 'POST',
        headers: { 'xi-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({ text: clip.text, model_id: MODEL_ID }),
      });
      if (!response.ok) {
        throw new Error(`Prompt synthesis failed (${response.status}) for ${clip.id}: ${(await response.text()).slice(0, 200)}`);
      }
      writeFileSync(outFile, Buffer.from(await response.arrayBuffer()));
      totalChars += clip.text.length;
      console.log(`wrote ${path.relative(ROOT, outFile)}`);
    }
  }

  console.log(`done · ${totalChars} characters billed this run`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
