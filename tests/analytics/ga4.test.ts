import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('External analytics shutdown', () => {
  const layout = fs.readFileSync(path.resolve(__dirname, '../../app/layout.tsx'), 'utf-8');
  const requestForm = fs.readFileSync(
    path.resolve(__dirname, '../../components/landing/request-access-form.tsx'),
    'utf-8',
  );
  const packageJson = fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8');

  it('does not load Google Analytics on any root-layout surface', () => {
    expect(layout).not.toContain('GoogleAnalytics');
    expect(layout).not.toContain('NEXT_PUBLIC_GA_MEASUREMENT_ID');
    expect(layout).not.toContain('@next/third-parties/google');
  });

  it('does not transmit access-request metadata to a third party', () => {
    expect(requestForm).not.toContain('window.gtag');
    expect(requestForm).not.toContain('sendGAEvent');
  });

  it('removes the third-party analytics runtime dependency', () => {
    expect(packageJson).not.toContain('@next/third-parties');
  });
});
