/**
 * Sandbox Live Call -- Runtime TTS (server only)
 *
 * Synthesizes the assistant's DYNAMIC lines (small-talk acks, paraphrases)
 * for the simulated live call. Only text the deterministic engine decided to
 * say ever reaches this module — there is no public text-to-speech surface.
 * Canonical lines stay pre-generated static clips (public/outreach-audio/).
 *
 * Guards: SANDBOX_TTS_ENABLED kill switch, ELEVENLABS_API_KEY presence, and
 * a hard per-line character cap. Any failure returns null and the call
 * degrades to text-only for that line.
 */

import 'server-only';

// Same premade voice as the pre-generated clips (Jessica). The clips use
// eleven_v3 (one-shot generation); runtime lines use the low-latency flash
// model so the reply lands within conversational delay.
const VOICE_ID = 'cgSgspJ2msm6clMCkdW9';
const MODEL_ID = 'eleven_flash_v2_5';
const MAX_TTS_CHARS = 300;
const TIMEOUT_MS = 8_000;

export function ttsEnabled(): boolean {
  return process.env.SANDBOX_TTS_ENABLED === 'true' && Boolean(process.env.ELEVENLABS_API_KEY);
}

/** MP3 audio (base64) for one short assistant line, or null on any failure. */
export async function synthesizeSpeech(text: string): Promise<string | null> {
  if (!ttsEnabled() || text.length === 0 || text.length > MAX_TTS_CHARS) return null;
  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY as string,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ text, model_id: MODEL_ID }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer()).toString('base64');
  } catch {
    return null;
  }
}
