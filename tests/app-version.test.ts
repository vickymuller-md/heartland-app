import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP_VERSION } from '@/lib/app-version';

describe('APP_VERSION', () => {
  it('matches package.json so public footers can never lag a release again', () => {
    const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(APP_VERSION).toBe(`v${version}`);
  });
});
