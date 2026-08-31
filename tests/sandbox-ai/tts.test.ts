import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { synthesizeSpeech, ttsEnabled } from '@/lib/sandbox-ai/tts';

function okResponse(payload = 'mp3!') {
  return {
    ok: true,
    arrayBuffer: async () => new TextEncoder().encode(payload).buffer,
  };
}

beforeEach(() => {
  vi.stubEnv('SANDBOX_TTS_ENABLED', 'true');
  vi.stubEnv('ELEVENLABS_API_KEY', 'test-key');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('ttsEnabled', () => {
  it('requires both the kill-switch flag and the vendor key', () => {
    expect(ttsEnabled()).toBe(true);
    vi.stubEnv('SANDBOX_TTS_ENABLED', 'false');
    expect(ttsEnabled()).toBe(false);
    vi.stubEnv('SANDBOX_TTS_ENABLED', 'true');
    vi.stubEnv('ELEVENLABS_API_KEY', '');
    expect(ttsEnabled()).toBe(false);
  });
});

describe('synthesizeSpeech', () => {
  it('returns base64 MP3 audio and authenticates with the vendor key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    const audio = await synthesizeSpeech('What a treat to have your grandson visit.');
    expect(audio).toBe(Buffer.from('mp3!').toString('base64'));
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('https://api.elevenlabs.io/v1/text-to-speech/');
    expect(init.headers['xi-api-key']).toBe('test-key');
  });

  it('never calls the vendor when disabled, keyless, empty, or over the char cap', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    vi.stubEnv('SANDBOX_TTS_ENABLED', 'false');
    expect(await synthesizeSpeech('hello there')).toBeNull();

    vi.stubEnv('SANDBOX_TTS_ENABLED', 'true');
    vi.stubEnv('ELEVENLABS_API_KEY', '');
    expect(await synthesizeSpeech('hello there')).toBeNull();

    vi.stubEnv('ELEVENLABS_API_KEY', 'test-key');
    expect(await synthesizeSpeech('')).toBeNull();
    expect(await synthesizeSpeech('x'.repeat(751))).toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('degrades to null on vendor errors and network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    expect(await synthesizeSpeech('hello there')).toBeNull();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await synthesizeSpeech('hello there')).toBeNull();
  });
});
