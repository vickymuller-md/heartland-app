// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import path from 'node:path';

const mocks = vi.hoisted(() => ({ files: new Map<string, string | Buffer>(), fetch: vi.fn() }));
vi.mock('node:fs', () => ({
  existsSync: vi.fn((file: string) => mocks.files.has(file)),
  readFileSync: vi.fn((file: string) => {
    if (!mocks.files.has(file)) throw new Error(`Missing test file: ${file}`);
    return mocks.files.get(file);
  }),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn((file: string, content: string | Buffer) => mocks.files.set(file, content)),
}));
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { audioCatalog, parseAudioArgs, planAudioGeneration, runAudioGeneration } from '../../scripts/generate-outreach-audio.mts';

const root = path.resolve(import.meta.dirname, '../..');
const out = path.join(root, 'public/outreach-audio');
const clip = 'prompts/daily_checkin/en/escalated.mp3';
const select = ['--only', clip];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.files.clear();
  vi.stubGlobal('fetch', mocks.fetch);
  vi.stubEnv('ELEVENLABS_API_KEY', 'test-key');
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('outreach audio planning', () => {
  it('has unique exact relative paths and fingerprints for all clips', () => {
    const catalog = audioCatalog();
    expect(catalog).toHaveLength(58);
    expect(new Set(catalog.map((job) => job.relativePath)).size).toBe(58);
    expect(catalog.every((job) => /^[a-f0-9]{64}$/.test(job.sourceSha256))).toBe(true);
    expect(catalog.every((job) => job.characters > 0)).toBe(true);
    const dialogue = catalog.find((job) => job.relativePath === 'call-maria-redflag.mp3')!;
    const inputs = JSON.parse(dialogue.body).inputs as Array<{ text: string }>;
    expect(inputs.some((input) => input.text.includes('[tired]'))).toBe(true);
    expect(dialogue.characters).toBe(inputs.reduce((sum, input) => sum + input.text.length, 0));
  });

  it('selects only named clips and excludes English dialogues for Spanish-only runs', () => {
    const plan = planAudioGeneration(parseAudioArgs(select));
    expect(plan.jobs.map((job) => job.relativePath)).toEqual([clip]);
    const es = planAudioGeneration(parseAudioArgs(['--locales', 'es']));
    expect(es.jobs.every((job) => job.locale === 'es')).toBe(true);
    expect(es.jobs).toHaveLength(27);
  });

  it.each([
    ['--only', '../secret.mp3'], ['--only', 'missing.mp3'], ['--only'],
    ['--locales', 'fr'], ['--locales', 'en,'], ['--max-chars', '-1'],
    ['--max-chars', '1.5'], ['--max-chars', 'NaN'], ['--unknown'],
    ['--only', clip, '--locales', 'es'],
  ])('rejects invalid selection/options before credentials or network: %j', (...args) => {
    expect(() => planAudioGeneration(parseAudioArgs(args))).toThrow();
    expect(readFileSync).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('dry-runs without credentials, network, directories or writes', async () => {
    vi.stubEnv('ELEVENLABS_API_KEY', '');
    const plan = await runAudioGeneration([...select, '--dry-run']);
    expect(plan.characters).toBeGreaterThan(0);
    expect(readFileSync).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mkdirSync).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it('requires a budget and fails before credentials/network when exceeded', async () => {
    await expect(runAudioGeneration(select)).rejects.toThrow('--max-chars');
    await expect(runAudioGeneration([...select, '--max-chars', '1'])).rejects.toThrow('budget');
    expect(readFileSync).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it('labels existing audio without a receipt unverified and never silently overwrites it', () => {
    mocks.files.set(path.join(out, clip), Buffer.from('old audio'));
    const plan = planAudioGeneration(parseAudioArgs(select));
    expect(plan.jobs[0].state).toBe('unverified');
    expect(plan.jobs[0].generate).toBe(false);
    expect(plan.characters).toBe(0);
    expect(planAudioGeneration(parseAudioArgs([...select, '--force'])).jobs[0].generate).toBe(true);
  });

  it('verifies both source and audio hashes, without blessing historical clips', () => {
    const job = audioCatalog().find((entry) => entry.relativePath === clip)!;
    const bytes = Buffer.from('test audio');
    mocks.files.set(path.join(out, clip), bytes);
    mocks.files.set(path.join(out, 'generation-manifest.json'), JSON.stringify({
      schemaVersion: 1,
      clips: { [clip]: { sourceSha256: job.sourceSha256, audioSha256: createHash('sha256').update(bytes).digest('hex'), generatedAt: '2026-09-11T00:00:00.000Z', modelId: 'eleven_v3' } },
    }));
    expect(planAudioGeneration(parseAudioArgs(select)).jobs[0].state).toBe('current');
    const staleSource = JSON.parse(mocks.files.get(path.join(out, 'generation-manifest.json')) as string);
    staleSource.clips[clip].sourceSha256 = 'a'.repeat(64);
    mocks.files.set(path.join(out, 'generation-manifest.json'), JSON.stringify(staleSource));
    expect(planAudioGeneration(parseAudioArgs(select)).jobs[0].state).toBe('stale');
    staleSource.clips[clip].sourceSha256 = job.sourceSha256;
    mocks.files.set(path.join(out, 'generation-manifest.json'), JSON.stringify(staleSource));
    mocks.files.set(path.join(out, clip), Buffer.from('different audio'));
    expect(planAudioGeneration(parseAudioArgs(select)).jobs[0].state).toBe('stale');
  });

  it('refuses malformed provenance instead of silently replacing it', async () => {
    mocks.files.set(path.join(out, 'generation-manifest.json'), '{bad json');
    await expect(runAudioGeneration([...select, '--max-chars', '10000'])).rejects.toThrow();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
  });
});

describe('outreach audio execution', () => {
  it('uses an environment key without requiring .env.local and receipts only generated clips', async () => {
    mocks.fetch.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } }));
    const plan = await runAudioGeneration([...select, '--max-chars', '10000']);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const [url, request] = mocks.fetch.mock.calls[0];
    expect(url).toContain('/text-to-speech/');
    expect(request.headers['xi-api-key']).toBe('test-key');
    expect(request.signal).toBeDefined();
    expect(mocks.files.get(path.join(out, clip))).toEqual(Buffer.from([1, 2, 3]));
    const manifest = JSON.parse(mocks.files.get(path.join(out, 'generation-manifest.json')) as string);
    expect(Object.keys(manifest.clips)).toEqual([clip]);
    expect(manifest.clips[clip].sourceSha256).toBe(plan.jobs[0].sourceSha256);
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it.each([
    new Response('secret provider detail', { status: 429 }),
    new Response('{}', { headers: { 'content-type': 'application/json' } }),
    new Response(new Uint8Array(), { headers: { 'content-type': 'audio/mpeg' } }),
  ])('does not write audio or expose provider bodies on synthesis failure', async (response) => {
    mocks.fetch.mockResolvedValue(response);
    const error = await runAudioGeneration([...select, '--max-chars', '10000']).catch((caught: Error) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/synthesis|audio/i);
    expect((error as Error).message).not.toContain('secret provider detail');
    expect(writeFileSync).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain('secret provider detail');
  });

  it('does not automatically retry a timeout with an uncertain provider outcome', async () => {
    mocks.fetch.mockRejectedValue(new DOMException('Request timed out', 'TimeoutError'));
    await expect(runAudioGeneration([...select, '--max-chars', '10000'])).rejects.toThrow('timed out');
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(writeFileSync).not.toHaveBeenCalled();
  });
});
