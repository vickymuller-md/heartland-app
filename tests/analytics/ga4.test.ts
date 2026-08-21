import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Public-only web analytics boundary', () => {
  const layout = fs.readFileSync(path.resolve(__dirname, '../../app/layout.tsx'), 'utf-8');
  const publicAnalytics = fs.readFileSync(
    path.resolve(__dirname, '../../components/analytics/public-web-analytics.tsx'),
    'utf-8',
  );
  const requestForm = fs.readFileSync(
    path.resolve(__dirname, '../../components/landing/request-access-form.tsx'),
    'utf-8',
  );
  const packageJson = fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8');

  it('keeps Google Analytics and third-party metadata transmission disabled', () => {
    expect(layout).not.toContain('GoogleAnalytics');
    expect(layout).not.toContain('NEXT_PUBLIC_GA_MEASUREMENT_ID');
    expect(layout).not.toContain('@next/third-parties/google');
    expect(requestForm).not.toContain('window.gtag');
    expect(requestForm).not.toContain('sendGAEvent');
  });

  it('loads privacy-safe analytics through the controlled public-route component', () => {
    expect(layout).toContain('PublicWebAnalytics');
    expect(publicAnalytics).toContain("from '@vercel/analytics/next'");
    expect(publicAnalytics).toContain('PUBLIC_PATHS');
    expect(publicAnalytics).toContain("'/sandbox'");
    expect(publicAnalytics).toContain("'/request-access'");
    expect(publicAnalytics).toContain('return null');
    expect(publicAnalytics).not.toContain('/patients/');
  });

  it('uses no general-purpose third-party analytics runtime', () => {
    expect(packageJson).not.toContain('@next/third-parties');
    expect(packageJson).toContain('@vercel/analytics');
  });
});
